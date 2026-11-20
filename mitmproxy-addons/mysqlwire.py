"""
mitmproxy addon: read the MySQL client/server protocol (MySQL and MariaDB) in TCP flows.

Part of @viaalink/caddy-api-client (MIT). Load it with
`mitmweb --mode reverse:tcp://<mysql host>:3306@<port> -s mysqlwire.py`; the
library's mitmproxyAddonPath("mysqlwire") gives its path inside the package.

The server's greeting says which server it is (MySQL or MariaDB, and its
version). Client packets become the SQL that was sent (COM_QUERY), prepared
statements (COM_STMT_PREPARE) and their executions with the parameters
(COM_STMT_EXECUTE); server packets become the outcome: columns, rows returned,
OK packets (rows affected, insert id) and errors. In mitmweb's Stream Data tab
each TCP message shows decoded (the "MySQL" content view, picked
automatically), the Comment tab holds the whole session as one transcript,
and every line is logged too.

Passwords: the transcript never shows the login's auth response or any later
auth data (auth switch, full authentication, COM_CHANGE_USER), and the TCP
messages that carried them are blanked in the stored flow once they have been
forwarded, so mitmweb's Raw view does not show them either.

Plain connections only: when the client asks for TLS (an SSLRequest), the
transcript says so and decoding stops there.

Packets can be split over TCP chunks or several can share one chunk, so every
flow keeps a buffer per direction and only complete packets are decoded.

The addon only takes flows that look like MySQL (the server speaks first, with
a protocol 10 greeting), so it can be loaded next to pgwire.py and
rediswire.py in one mitmproxy.
"""
from __future__ import annotations

import logging
import struct
from collections import deque

from mitmproxy import contentviews, tcp

NAME = "mysqlwire"
ROWS_SHOWN = 20  # per result; the rest is counted
TEXT_SHOWN = 80  # characters of one value

# Capability flags
CLIENT_CONNECT_WITH_DB = 0x8
CLIENT_PROTOCOL_41 = 0x200
CLIENT_SSL = 0x800
CLIENT_SECURE_CONNECTION = 0x8000
CLIENT_PLUGIN_AUTH = 0x80000
CLIENT_CONNECT_ATTRS = 0x100000
CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 0x200000
CLIENT_SESSION_TRACK = 0x800000
CLIENT_DEPRECATE_EOF = 0x1000000
CLIENT_QUERY_ATTRIBUTES = 0x8000000

SERVER_MORE_RESULTS_EXISTS = 0x8
PARAMETER_COUNT_AVAILABLE = 0x8  # COM_STMT_EXECUTE flags

COMMANDS = {
    0x00: "SLEEP", 0x01: "QUIT", 0x02: "USE", 0x03: "SQL", 0x04: "FIELD LIST",
    0x05: "CREATE DB", 0x06: "DROP DB", 0x07: "REFRESH", 0x08: "SHUTDOWN",
    0x09: "STATISTICS", 0x0A: "PROCESS INFO", 0x0B: "CONNECT", 0x0C: "KILL",
    0x0D: "DEBUG", 0x0E: "PING", 0x11: "CHANGE USER", 0x12: "BINLOG DUMP",
    0x16: "PREPARE", 0x17: "EXECUTE", 0x18: "LONG DATA", 0x19: "CLOSE",
    0x1A: "RESET", 0x1B: "SET OPTION", 0x1C: "FETCH", 0x1F: "RESET CONNECTION",
    0xFA: "BULK EXECUTE",
}


class Incomplete(Exception):
    """The buffer ends inside a packet: wait for more bytes."""


WHITESPACE = str.maketrans("", "", "\r\n\t")


def fmt_value(value: bytes | None, limit: int = TEXT_SHOWN) -> str:
    if value is None:
        return "NULL"
    try:
        text = value.decode("utf-8")
    except UnicodeDecodeError:
        text = None
    # Line breaks and tabs are fine in text (repr shows them as \n, \t).
    if text is None or not text.translate(WHITESPACE).isprintable():
        shown = "0x" + value[: limit // 2].hex()
        return shown + (f"… ({len(value)} bytes)" if len(value) > limit // 2 else "")
    if len(text) > limit:
        return repr(text[:limit]) + f"… ({len(value)} bytes)"
    return repr(text)


def fmt_number(x: float) -> str:
    return str(int(x)) if x == x and x not in (float("inf"), float("-inf")) and x.is_integer() else repr(x)


# ─── reading packet payloads ───────────────────────────────────────────────


class Reader:
    def __init__(self, data: bytes, pos: int = 0) -> None:
        self.data = data
        self.pos = pos

    def left(self) -> int:
        return len(self.data) - self.pos

    def bytes(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise ValueError("packet ends early")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def int(self, n: int) -> int:
        return int.from_bytes(self.bytes(n), "little")

    def lenenc(self) -> int | None:
        first = self.int(1)
        if first < 0xFB:
            return first
        if first == 0xFB:
            return None  # NULL in a text row
        return self.int({0xFC: 2, 0xFD: 3, 0xFE: 8}[first]) if first != 0xFF else self._bad()

    @staticmethod
    def _bad() -> int:
        raise ValueError("bad length-encoded integer")

    def lenenc_bytes(self) -> bytes | None:
        n = self.lenenc()
        return None if n is None else self.bytes(n)

    def cstr(self) -> bytes:
        end = self.data.index(b"\x00", self.pos)
        out = self.data[self.pos : end]
        self.pos = end + 1
        return out

    def rest(self) -> bytes:
        out = self.data[self.pos :]
        self.pos = len(self.data)
        return out


def read_binary(r: Reader, kind: int, unsigned: bool) -> str:
    """One value in the binary protocol (COM_STMT_EXECUTE parameters, binary rows)."""
    ints = {0x01: 1, 0x02: 2, 0x0D: 2, 0x03: 4, 0x09: 4, 0x08: 8}
    if kind in ints:
        n = ints[kind]
        return str(int.from_bytes(r.bytes(n), "little", signed=not unsigned))
    if kind == 0x04:
        return fmt_number(struct.unpack("<f", r.bytes(4))[0])
    if kind == 0x05:
        return fmt_number(struct.unpack("<d", r.bytes(8))[0])
    if kind == 0x06:
        return "NULL"
    if kind in (0x07, 0x0A, 0x0C):  # timestamp, date, datetime
        n = r.int(1)
        f = Reader(r.bytes(n))
        if n == 0:
            return "'0000-00-00'"
        y, mo, d = f.int(2), f.int(1), f.int(1)
        out = f"{y:04}-{mo:02}-{d:02}"
        if n >= 7:
            out += f" {f.int(1):02}:{f.int(1):02}:{f.int(1):02}"
        if n >= 11:
            out += f".{f.int(4):06}"
        return repr(out)
    if kind == 0x0B:  # time
        n = r.int(1)
        f = Reader(r.bytes(n))
        if n == 0:
            return "'00:00:00'"
        neg, days, h, m, s = f.int(1), f.int(4), f.int(1), f.int(1), f.int(1)
        out = f"{'-' if neg else ''}{days * 24 + h:02}:{m:02}:{s:02}"
        if n >= 12:
            out += f".{f.int(4):06}"
        return repr(out)
    # Everything else is a length-encoded string: varchar, decimal, blob, json, enum, bit, …
    return fmt_value(r.lenenc_bytes())


# ─── packets ───────────────────────────────────────────────────────────────


class Direction:
    """One direction of a connection: its buffer and which messages fed it."""

    def __init__(self) -> None:
        self.buf = b""
        self.start = 0  # stream offset of buf[0]
        self.chunks: list[tuple[int, int, int]] = []  # (message index, first offset, end offset)

    def add(self, data: bytes, index: int) -> None:
        end = self.start + len(self.buf)
        self.chunks.append((index, end, end + len(data)))
        self.buf += data

    def next_packet(self) -> tuple[int, bytes, int]:
        """(sequence id, payload, bytes used) of the next whole packet; joins 16 MB continuations."""
        pos, payload, seq = 0, b"", None
        while True:
            if len(self.buf) < pos + 4:
                raise Incomplete
            n = int.from_bytes(self.buf[pos : pos + 3], "little")
            if seq is None:
                seq = self.buf[pos + 3]
            if len(self.buf) < pos + 4 + n:
                raise Incomplete
            payload += self.buf[pos + 4 : pos + 4 + n]
            pos += 4 + n
            if n < 0xFFFFFF:
                return seq, payload, pos

    def take(self, n: int) -> list[int]:
        """Consume n bytes; return the indexes of the messages they came from."""
        first, last = self.start, self.start + n
        indexes = [i for i, a, b in self.chunks if a < last and b > first]
        self.buf, self.start = self.buf[n:], last
        self.chunks = [c for c in self.chunks if c[2] > last]
        return indexes


def server_kind(version: str) -> tuple[str, str]:
    """("MariaDB" | "MySQL", clean version) from the greeting's version string."""
    if "mariadb" in version.lower():
        clean = version[6:] if version.startswith("5.5.5-") else version
        return "MariaDB", clean.split("-")[0]
    return "MySQL", version.split("-")[0]


def looks_like_mysql(first_server_bytes: bytes) -> bool | None:
    """
    Is this the greeting of a MySQL/MariaDB server (protocol 10, or an error
    instead)? None: too few bytes yet to tell.
    """
    data = first_server_bytes
    if len(data) >= 4 and data[3] != 0:
        return False
    if len(data) >= 5 and data[4] not in (10, 0xFF):
        return False
    n = int.from_bytes(data[0:3], "little") if len(data) >= 3 else None
    if n is not None and (n < 3 or (len(data) >= 5 and data[4] == 10 and n < 20)):
        return False
    if len(data) < 5 or (data[4] == 10 and b"\x00" not in data[5:] and len(data) < 5 + 64):
        return None
    if data[4] == 0xFF:
        return True
    end = data.find(b"\x00", 5)
    version = data[5:end] if end > 5 else b""
    return bool(version) and version[:1].isdigit() and all(32 <= c < 127 for c in version)


class Statement:
    def __init__(self, sql: str) -> None:
        self.sql = sql
        self.params = 0
        self.types: list[tuple[int, bool]] = []  # (type, unsigned) per parameter
        self.columns: list[tuple[str, int, bool]] = []


class Response:
    """What the server's next packets answer, and how far it got."""

    def __init__(self, kind: str, stmt: Statement | None = None, binary: bool = False) -> None:
        self.kind = kind  # result | prepare | ok | stats | fieldlist | fetch | unknown
        self.stmt = stmt
        self.binary = binary
        self.stage = "first"
        self.columns: list[tuple[str, int, bool]] = []
        self.left = 0  # column definitions still to come
        self.rows = 0
        self.skip = 0  # prepare: definitions still to skip
        self.prepared: Statement | None = None


class MySQLConnection:
    """Both directions of one MySQL/MariaDB connection."""

    def __init__(self) -> None:
        self.client = Direction()
        self.server = Direction()
        self.phase = "greeting"  # greeting → login → auth → command; or tls / broken
        self.server_caps = 0
        self.caps = 0
        self.plugin = ""
        self.pending: deque[Response] = deque()
        self.response: Response | None = None
        self.stmts: dict[int, Statement] = {}
        self.last_stmt: Statement | None = None
        self.preparing: deque[Statement] = deque()
        self.infile = 0

    # ── shared bits ──

    def eof_deprecated(self) -> bool:
        return bool(self.caps & CLIENT_DEPRECATE_EOF)

    def describe_ok(self, payload: bytes) -> tuple[str, int]:
        r = Reader(payload, 1)
        affected = r.lenenc() or 0
        insert_id = r.lenenc() or 0
        status = warnings = 0
        if self.caps & CLIENT_PROTOCOL_41 and r.left() >= 4:
            status, warnings = r.int(2), r.int(2)
        info = b""
        if r.left():
            info = (r.lenenc_bytes() or b"") if self.caps & CLIENT_SESSION_TRACK else r.rest()
        line = f"OK  {affected} row{'s' if affected != 1 else ''} affected"
        if insert_id:
            line += f", insert id {insert_id}"
        if warnings:
            line += f", {warnings} warning{'s' if warnings != 1 else ''}"
        if info:
            line += f"  ({info.decode('utf-8', 'replace')})"
        return line, status

    def describe_err(self, payload: bytes) -> str | None:
        r = Reader(payload, 1)
        code = r.int(2)
        if code == 0xFFFF:
            return None  # MariaDB progress report
        state = ""
        if r.left() and payload[r.pos : r.pos + 1] == b"#":
            r.pos += 1
            state = r.bytes(5).decode()
        message = r.rest().decode("utf-8", "replace")
        return f"ERROR  {code}{f' ({state})' if state else ''} {message}"

    @staticmethod
    def is_eof(payload: bytes) -> bool:
        return payload[:1] == b"\xfe" and len(payload) < 0xFFFFFF and len(payload) < 9

    def is_end_of_rows(self, payload: bytes) -> bool:
        if payload[:1] != b"\xfe":
            return False
        # With CLIENT_DEPRECATE_EOF the result ends with an OK packet that starts with 0xFE.
        return len(payload) < 0xFFFFFF if self.eof_deprecated() else len(payload) < 9

    # ── client → server ──

    def client_packet(self, seq: int, payload: bytes) -> tuple[str | None, bool]:
        if self.phase == "login":
            return self.handshake_response(payload)
        if self.phase == "auth":
            if payload == b"\x02":
                return "LOGIN  public key asked", False
            return "LOGIN  auth data sent (not shown)", True
        if self.phase != "command":
            return None, False
        if self.infile:
            if payload:
                self.infile += len(payload)
                return None, False
            sent, self.infile = self.infile - 1, 0
            return f"LOCAL INFILE  {sent} bytes sent", False
        if not payload:
            return None, False
        return self.command(payload)

    def handshake_response(self, payload: bytes) -> tuple[str, bool]:
        r = Reader(payload)
        caps = r.int(4) if len(payload) >= 4 else 0
        if not caps & CLIENT_PROTOCOL_41:
            raise ValueError("pre-4.1 handshake response: not decoded")
        if len(payload) == 32 and caps & CLIENT_SSL:
            self.phase = "tls"
            return "SSL request: TLS follows, the rest of this connection is encrypted and not decoded", False
        self.caps = caps & self.server_caps if self.server_caps else caps
        r.pos += 4 + 1 + 23  # max packet, charset, filler
        user = r.cstr().decode("utf-8", "replace")
        if caps & CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA:
            r.lenenc_bytes()
        elif caps & CLIENT_SECURE_CONNECTION:
            r.bytes(r.int(1))
        else:
            r.cstr()
        db = r.cstr().decode("utf-8", "replace") if caps & CLIENT_CONNECT_WITH_DB and r.left() else ""
        plugin = r.cstr().decode() if caps & CLIENT_PLUGIN_AUTH and r.left() else ""
        self.phase = "auth"
        line = f"CONNECT  user={user}" + (f" database={db}" if db else "")
        if plugin:
            line += f" auth={plugin}"
        return line + "  (credentials not shown)", True

    def command(self, payload: bytes) -> tuple[str | None, bool]:
        code = payload[0]
        body = payload[1:]
        name = COMMANDS.get(code, f"COMMAND 0x{code:02x}")
        if code == 0x03:
            self.pending.append(Response("result"))
            return f"SQL  {self.query_text(body)}", False
        if code == 0x16:
            stmt = Statement(body.decode("utf-8", "replace").strip())
            self.preparing.append(stmt)
            self.pending.append(Response("prepare", stmt))
            return f"PREPARE  {stmt.sql}", False
        if code in (0x17, 0xFA):
            return self.execute(code, body), False
        if code == 0x11:
            r = Reader(body)
            user = r.cstr().decode("utf-8", "replace")
            self.phase = "auth"
            return f"CHANGE USER  user={user}  (credentials not shown)", True
        if code == 0x01:
            return "QUIT", False
        if code == 0x19:
            stmt_id = int.from_bytes(body[:4], "little")
            self.stmts.pop(stmt_id, None)
            return f"CLOSE  stmt {stmt_id}", False
        if code == 0x18:
            r = Reader(body)
            stmt_id, param = r.int(4), r.int(2)
            return f"LONG DATA  stmt {stmt_id} ?{param + 1}  ({r.left()} bytes)", False
        if code == 0x1C:
            r = Reader(body)
            stmt_id, rows = r.int(4), r.int(4)
            self.pending.append(Response("fetch", self.stmts.get(stmt_id), binary=True))
            return f"FETCH  stmt {stmt_id}, {rows} rows", False
        if code == 0x1A:
            self.pending.append(Response("ok"))
            return f"RESET  stmt {int.from_bytes(body[:4], 'little')}", False
        if code == 0x02:
            self.pending.append(Response("ok"))
            return f"USE  {body.decode('utf-8', 'replace')}", False
        if code == 0x04:
            self.pending.append(Response("fieldlist"))
            return f"FIELD LIST  {Reader(body).cstr().decode('utf-8', 'replace')}", False
        if code == 0x09:
            self.pending.append(Response("stats"))
            return name, False
        if code == 0x0A:
            self.pending.append(Response("result"))
            return name, False
        if code in (0x0C, 0x0E, 0x0D, 0x1B, 0x1F, 0x05, 0x06, 0x07, 0x08):
            self.pending.append(Response("ok"))
            return name, False
        self.pending.append(Response("unknown"))
        return name, False

    def query_text(self, body: bytes) -> str:
        r = Reader(body)
        attrs = []
        if self.caps & CLIENT_QUERY_ATTRIBUTES:
            n = r.lenenc() or 0
            r.lenenc()  # parameter set count, always 1
            if n:
                nulls = r.bytes((n + 7) // 8)
                types: list[tuple[int, bool, str]] = []
                if r.int(1):
                    for _ in range(n):
                        t, flags = r.int(1), r.int(1)
                        types.append((t, bool(flags & 0x80), (r.lenenc_bytes() or b"").decode()))
                for i, (t, unsigned, attr) in enumerate(types):
                    value = "NULL" if nulls[i // 8] & (1 << (i % 8)) else read_binary(r, t, unsigned)
                    attrs.append(f"{attr}={value}")
        sql = r.rest().decode("utf-8", "replace").strip()
        return sql + (f"  [attributes {', '.join(attrs)}]" if attrs else "")

    def execute(self, code: int, body: bytes) -> str:
        r = Reader(body)
        stmt_id = r.int(4)
        flags = r.int(2) if code == 0xFA else r.int(1)
        stmt = self.last_stmt if stmt_id == 0xFFFFFFFF else self.stmts.get(stmt_id)
        label = "BULK EXECUTE" if code == 0xFA else "EXECUTE"
        self.pending.append(Response("result", stmt, binary=True))
        if stmt is None:
            return f"{label}  stmt {stmt_id}  (statement prepared before decoding started; parameters not shown)"
        shown_id = stmt_id if stmt_id != 0xFFFFFFFF else "last"
        if code == 0xFA:
            return f"{label}  stmt {shown_id}  (parameters not shown)"
        r.int(4)  # iteration count, always 1
        n = stmt.params
        attrs = self.caps & CLIENT_QUERY_ATTRIBUTES
        if attrs and flags & PARAMETER_COUNT_AVAILABLE:
            n = r.lenenc() or 0
        if n == 0:
            return f"{label}  stmt {shown_id}  (no parameters)"
        nulls = r.bytes((n + 7) // 8)
        if r.int(1):  # new parameter types follow
            types = []
            for _ in range(n):
                t, f = r.int(1), r.int(1)
                if attrs:
                    r.lenenc_bytes()  # attribute name
                types.append((t, bool(f & 0x80)))
            stmt.types = types
        if len(stmt.types) < n:
            return f"{label}  stmt {shown_id}  (parameter types unknown)"
        values = []
        for i in range(n):
            if nulls[i // 8] & (1 << (i % 8)):
                values.append("NULL")
            else:
                t, unsigned = stmt.types[i]
                values.append(read_binary(r, t, unsigned))
        shown = ", ".join(f"?{i + 1}={v}" for i, v in enumerate(values))
        return f"{label}  stmt {shown_id}  {shown}"

    # ── server → client ──

    def server_packet(self, seq: int, payload: bytes) -> list[str]:
        if self.phase == "greeting":
            return self.greeting(payload)
        if self.phase == "auth":
            return self.auth_reply(payload)
        if self.phase != "command":
            return []
        if self.response is None:
            if not self.pending:
                return [self.generic(payload)]
            self.response = self.pending.popleft()
        return self.answer(self.response, payload)

    def greeting(self, payload: bytes) -> list[str]:
        if payload[:1] == b"\xff":
            line = self.describe_err(payload)
            return [line] if line else []
        r = Reader(payload, 1)
        version = r.cstr().decode("utf-8", "replace")
        connection_id = r.int(4)
        r.bytes(8 + 1)  # auth data part 1, filler
        caps = r.int(2)
        plugin = ""
        if r.left():
            r.int(1)  # charset
            r.int(2)  # status
            caps |= r.int(2) << 16
            auth_len = r.int(1)
            r.bytes(10)
            if caps & CLIENT_SECURE_CONNECTION:
                r.bytes(max(13, auth_len - 8))
            if caps & CLIENT_PLUGIN_AUTH and r.left():
                plugin = r.cstr().decode() if b"\x00" in payload[r.pos :] else r.rest().decode()
        self.server_caps = caps
        self.plugin = plugin
        self.phase = "login"
        kind, clean = server_kind(version)
        line = f"SERVER  {kind} {clean}  (version string {version!r}, connection {connection_id}"
        return [line + (f", auth {plugin})" if plugin else ")")]

    def auth_reply(self, payload: bytes) -> list[str]:
        first = payload[:1]
        if first == b"\x00":
            self.phase = "command"
            return ["LOGIN  ok"]
        if first == b"\xff":
            line = self.describe_err(payload)
            return [line] if line else []
        if first == b"\xfe":
            if len(payload) == 1:
                return ["LOGIN  switch to the old password method"]
            r = Reader(payload, 1)
            plugin = r.cstr().decode() if b"\x00" in payload[1:] else r.rest().decode()
            return [f"LOGIN  switch to {plugin}"]
        if first == b"\x01":
            data = payload[1:]
            if data == b"\x03":
                return ["LOGIN  fast auth ok (cached)"]
            if data == b"\x04":
                return ["LOGIN  full authentication asked"]
            if data.startswith(b"-----BEGIN"):
                return ["LOGIN  server public key sent"]
            return [f"LOGIN  more auth data ({len(data)} bytes)"]
        return [f"LOGIN  auth packet 0x{payload[0]:02x}" if payload else "LOGIN  empty packet"]

    def generic(self, payload: bytes) -> str:
        if payload[:1] == b"\x00":
            return self.describe_ok(payload)[0]
        if payload[:1] == b"\xff":
            return self.describe_err(payload) or "(progress report)"
        return f"(packet of {len(payload)} bytes)"

    def column(self, payload: bytes) -> tuple[str, int, bool]:
        r = Reader(payload)
        for _ in range(4):  # catalog, schema, table, original table
            r.lenenc_bytes()
        name = (r.lenenc_bytes() or b"").decode("utf-8", "replace")
        r.lenenc_bytes()  # original name
        r.lenenc()  # length of the fixed fields
        r.int(2)  # charset
        r.int(4)  # column length
        kind = r.int(1)
        flags = r.int(2)
        return name, kind, bool(flags & 0x20)

    def text_row(self, payload: bytes, n: int) -> str:
        r = Reader(payload)
        return "ROW  " + ", ".join(fmt_value(r.lenenc_bytes()) for _ in range(n))

    def binary_row(self, payload: bytes, columns: list[tuple[str, int, bool]]) -> str:
        r = Reader(payload, 1)
        n = len(columns)
        nulls = r.bytes((n + 7 + 2) // 8)
        values = []
        for i, (_name, kind, unsigned) in enumerate(columns):
            bit = i + 2
            if nulls[bit // 8] & (1 << (bit % 8)):
                values.append("NULL")
            else:
                values.append(read_binary(r, kind, unsigned))
        return "ROW  " + ", ".join(values)

    def answer(self, resp: Response, payload: bytes) -> list[str]:
        first = payload[:1]
        if resp.kind == "prepare":
            return self.answer_prepare(resp, payload)
        if resp.kind in ("ok", "unknown"):
            self.response = None
            if first == b"\xfe":
                return ["OK"]
            return [self.generic(payload)]
        if resp.kind == "stats":
            self.response = None
            if first == b"\xff":
                return [self.generic(payload)]
            return [f"STATISTICS  {payload.decode('utf-8', 'replace')}"]
        if resp.kind == "fieldlist":
            if first == b"\xff" or self.is_eof(payload):
                self.response = None
                return [self.generic(payload)] if first == b"\xff" else []
            return [f"FIELD  {self.column(payload)[0]}"]
        # result / fetch
        if resp.kind == "fetch" and resp.stage == "first":
            resp.stage = "rows"
            resp.columns = resp.stmt.columns if resp.stmt else []
        if resp.stage == "first":
            if first == b"\x00":
                line, status = self.describe_ok(payload)
                self.response = None
                if status & SERVER_MORE_RESULTS_EXISTS:
                    self.pending.appendleft(Response("result", resp.stmt, resp.binary))
                return [line]
            if first == b"\xff":
                self.response = None
                return [self.describe_err(payload) or "(progress report)"]
            if first == b"\xfb":
                self.response = None
                self.infile = 1
                self.pending.appendleft(Response("result", resp.stmt, resp.binary))
                return [f"LOCAL INFILE  the server asks for {payload[1:].decode('utf-8', 'replace')!r}"]
            resp.left = Reader(payload).lenenc() or 0
            resp.stage = "columns"
            return []
        if resp.stage == "columns":
            resp.columns.append(self.column(payload))
            resp.left -= 1
            if resp.left == 0:
                resp.stage = "rows" if self.eof_deprecated() else "eof"
                if resp.stmt is not None:
                    resp.stmt.columns = resp.columns
                return ["COLUMNS  " + ", ".join(c[0] for c in resp.columns)]
            return []
        if resp.stage == "eof":
            resp.stage = "rows"
            return []
        # rows
        if first == b"\xff":
            self.response = None
            return [self.describe_err(payload) or "(progress report)"]
        if self.is_end_of_rows(payload):
            self.response = None
            status = 0
            if self.eof_deprecated():
                _, status = self.describe_ok(payload)
            elif len(payload) >= 5:
                status = int.from_bytes(payload[3:5], "little")
            if status & SERVER_MORE_RESULTS_EXISTS:
                self.pending.appendleft(Response("result", resp.stmt, resp.binary))
            n = resp.rows
            return [f"DONE  {n} row{'s' if n != 1 else ''} returned"]
        resp.rows += 1
        if resp.rows <= ROWS_SHOWN:
            if resp.binary:
                return [self.binary_row(payload, resp.columns)]
            return [self.text_row(payload, len(resp.columns))]
        if resp.rows == ROWS_SHOWN + 1:
            return ["ROW  … (more rows, counted below)"]
        return []

    def answer_prepare(self, resp: Response, payload: bytes) -> list[str]:
        if resp.stage == "first":
            if payload[:1] == b"\xff":
                self.response = None
                if self.preparing:
                    self.preparing.popleft()
                return [self.describe_err(payload) or "(progress report)"]
            r = Reader(payload, 1)
            stmt_id, columns, params = r.int(4), r.int(2), r.int(2)
            stmt = self.preparing.popleft() if self.preparing else Statement("")
            stmt.params = params
            self.stmts[stmt_id] = stmt
            self.last_stmt = stmt
            eof = 0 if self.eof_deprecated() else 1
            resp.skip = (params + eof if params else 0) + (columns + eof if columns else 0)
            resp.stage = "definitions"
            if resp.skip == 0:
                self.response = None
            return [
                f"PREPARED  stmt {stmt_id}  ({params} parameter{'s' if params != 1 else ''}, "
                f"{columns} column{'s' if columns != 1 else ''})"
            ]
        resp.skip -= 1
        if resp.skip <= 0:
            self.response = None
        return []

    # ── both ──

    def feed(self, data: bytes, from_client: bool, index: int) -> tuple[list[str], set[int]]:
        """Decode what is complete; return the lines and the message indexes holding secrets."""
        lines: list[str] = []
        secret: set[int] = set()
        if self.phase in ("tls", "broken"):
            return lines, secret
        side = self.client if from_client else self.server
        side.add(data, index)
        while side.buf and self.phase not in ("tls", "broken"):
            try:
                seq, payload, used = side.next_packet()
            except Incomplete:
                break
            indexes = side.take(used)
            try:
                if from_client:
                    line, has_secret = self.client_packet(seq, payload)
                    if has_secret:
                        secret.update(indexes)
                    if line:
                        lines.append(line)
                else:
                    lines.extend(self.server_packet(seq, payload))
            except (ValueError, IndexError, KeyError, struct.error) as e:
                if from_client and self.phase in ("login", "auth"):
                    secret.update(indexes)  # whatever it was, it was login data
                self.phase = "broken"
                lines.append(f"(could not decode: {e}; the rest of this connection is left raw)")
        return lines, secret


# ─── the addon ─────────────────────────────────────────────────────────────


class MySQLWire:
    def __init__(self) -> None:
        self.connections: dict[str, MySQLConnection | None] = {}

    @staticmethod
    def _hide_secrets(flow: tcp.TCPFlow, keep_last: bool) -> None:
        """
        Blank messages that carried login data once they have been forwarded,
        so mitmweb's Raw and Auto views never show it. A message is sent when
        its tcp_message hook returns; only the stored copy is changed here.
        """
        pending = flow.metadata.get(f"{NAME}_hide", [])
        last = len(flow.messages) - 1
        for index in [i for i in pending if not (keep_last and i == last)]:
            message = flow.messages[index]
            message.content = f"({NAME}: login message hidden, {len(message.content)} bytes)".encode()
            pending.remove(index)

    def _claim(self, flow: tcp.TCPFlow) -> list[int]:
        """
        The indexes of the messages to decode now: the last one, or every one
        so far when this message is the one that shows the flow is MySQL.
        """
        if flow.id in self.connections:
            return [len(flow.messages) - 1] if self.connections[flow.id] else []
        claimed = flow.metadata.get("wire_protocol")
        if claimed not in (None, "mysql") or flow.messages[0].from_client:
            verdict: bool | None = False
        else:
            verdict = looks_like_mysql(b"".join(m.content for m in flow.messages if not m.from_client))
        if verdict is None:
            return []  # wait for more bytes
        self.connections[flow.id] = MySQLConnection() if verdict else None
        if not verdict:
            return []
        flow.metadata["wire_protocol"] = "mysql"
        return list(range(len(flow.messages)))

    def tcp_message(self, flow: tcp.TCPFlow) -> None:
        indexes = self._claim(flow)
        if not indexes:
            return
        self._hide_secrets(flow, keep_last=True)
        for index in indexes:
            self._decode(flow, index)

    def _decode(self, flow: tcp.TCPFlow, index: int) -> None:
        conn = self.connections[flow.id]
        msg = flow.messages[index]
        try:
            lines, secret = conn.feed(msg.content, msg.from_client, index)
        except Exception as e:  # never break the proxied connection over a decoding bug
            conn.phase = "broken"
            lines, secret = [f"(could not decode: {e})"], ({index} if msg.from_client else set())
        arrow = "→" if msg.from_client else "←"
        by_message = flow.metadata.setdefault(f"{NAME}_messages", {})
        by_message[index] = [f"{arrow} {line}" for line in lines]
        if secret:
            pending = flow.metadata.setdefault(f"{NAME}_hide", [])
            pending.extend(i for i in sorted(secret) if i not in pending)
            # Earlier chunks of a split packet are out already: blank them now.
            self._hide_secrets(flow, keep_last=True)
        if lines:
            log = flow.metadata.setdefault(NAME, [])
            for line in lines:
                log.append(f"{arrow} {line}")
                logging.info(f"[mysql {flow.id[:8]}] {arrow} {line}")
            flow.comment = "\n".join(log[-60:])

    def tcp_end(self, flow: tcp.TCPFlow) -> None:
        if self.connections.pop(flow.id, None) is not None:
            self._hide_secrets(flow, keep_last=False)

    def tcp_error(self, flow: tcp.TCPFlow) -> None:
        self.tcp_end(flow)


def _decoded_lines(flow, tcp_message) -> list[str] | None:
    """The mysqlwire lines of one TCP message, or None when it is not a decoded MySQL flow."""
    if not isinstance(flow, tcp.TCPFlow) or tcp_message is None:
        return None
    decoded = flow.metadata.get(f"{NAME}_messages")
    if decoded is None:
        return None
    index = next((i for i, m in enumerate(flow.messages) if m is tcp_message), None)
    return decoded.get(index) if index is not None else None


BOOKKEEPING = "(protocol bookkeeping, or part of a packet that continues in the next message)"


if hasattr(contentviews, "Contentview"):
    # mitmproxy 12 and later: prettify() returns text, Metadata carries the flow.

    class MySQLView(contentviews.Contentview):
        """Stream Data in mitmweb: each TCP message of a MySQL/MariaDB flow, decoded."""

        @property
        def name(self) -> str:
            return "MySQL"

        def prettify(self, data: bytes, metadata) -> str:
            lines = _decoded_lines(metadata.flow, metadata.tcp_message)
            if lines is None:
                return "(not decoded)"
            return "\n".join(lines) if lines else BOOKKEEPING

        def render_priority(self, data: bytes, metadata) -> float:
            return 2.0 if _decoded_lines(metadata.flow, metadata.tcp_message) is not None else -1.0

else:
    # mitmproxy 10 and 11: the older View API.

    class MySQLView(contentviews.View):  # type: ignore[no-redef]
        """Stream Data in mitmweb: each TCP message of a MySQL/MariaDB flow, decoded."""

        name = "MySQL"

        def __call__(self, data, *, flow=None, tcp_message=None, **metadata):
            lines = _decoded_lines(flow, tcp_message)
            if lines is None:
                return "MySQL", contentviews.format_text("(not decoded)")
            return "MySQL", iter([[("text", line)] for line in (lines or [BOOKKEEPING])])

        def render_priority(self, data, *, flow=None, tcp_message=None, **metadata) -> float:
            return 2.0 if _decoded_lines(flow, tcp_message) is not None else 0.0


view = MySQLView()


def load(loader) -> None:
    contentviews.add(view)


def done() -> None:
    # mitmproxy 12 has no way to unregister a view (its remove() is a deprecated no-op).
    if not hasattr(contentviews, "Contentview"):
        contentviews.remove(view)


addons = [MySQLWire()]
