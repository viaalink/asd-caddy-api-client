"""
mitmproxy addon: read the PostgreSQL wire protocol in TCP flows.

Part of @viaalink/caddy-api-client (MIT). Load it with
`mitmweb --mode reverse:tcp://<postgres host>:5432@<port> -s pgwire.py`; the
library's mitmproxyAddonPath("pgwire") gives its path inside the package.

Client messages become the SQL that was sent, with its parameters (simple and
extended query protocol); server messages become the outcome: columns, rows
returned, the command tag, errors. In mitmweb's Stream Data tab each TCP message
shows decoded (the "Postgres" content view, picked automatically), the
Comment tab holds the whole session as one transcript, and every line is
logged too.

Plain connections only: a client that gets TLS ("sslmode=require") encrypts
everything after the SSL request, and the transcript says so.

Messages can be split over TCP chunks or several can share one chunk, so every
flow keeps a buffer per direction and only complete messages are decoded.
"""
from __future__ import annotations

import logging
import struct

from mitmproxy import contentviews, tcp

SSL_REQUEST = 80877103
GSSENC_REQUEST = 80877104
CANCEL_REQUEST = 80877102
PROTOCOL_3 = 196608


def cstr(buf: bytes, pos: int) -> tuple[str, int]:
    end = buf.index(b"\x00", pos)
    return buf[pos:end].decode("utf-8", "replace"), end + 1


def fmt_param(value: bytes | None) -> str:
    if value is None:
        return "NULL"
    try:
        text = value.decode("utf-8")
    except UnicodeDecodeError:
        return "0x" + value.hex()
    return repr(text) if text.isprintable() else "0x" + value.hex()


def decode_frontend(kind: bytes, body: bytes) -> str | None:
    if kind == b"Q":
        sql, _ = cstr(body, 0)
        return f"SQL  {sql.strip()}"
    if kind == b"P":
        name, pos = cstr(body, 0)
        sql, pos = cstr(body, pos)
        return f"PARSE{(' ' + name) if name else ''}  {sql.strip()}"
    if kind == b"B":
        _portal, pos = cstr(body, 0)
        stmt, pos = cstr(body, pos)
        (nfmt,) = struct.unpack_from("!h", body, pos)
        pos += 2 + 2 * nfmt
        (nparams,) = struct.unpack_from("!h", body, pos)
        pos += 2
        params = []
        for _ in range(nparams):
            (length,) = struct.unpack_from("!i", body, pos)
            pos += 4
            if length < 0:
                params.append(None)
            else:
                params.append(body[pos : pos + length])
                pos += length
        shown = ", ".join(f"${i + 1}={fmt_param(p)}" for i, p in enumerate(params))
        return f"BIND{(' ' + stmt) if stmt else ''}  {shown or '(no parameters)'}"
    if kind == b"X":
        return "TERMINATE"
    if kind == b"p":
        return "LOGIN  credentials sent (not shown)"
    return None  # Execute, Sync, Describe, Flush, password: not interesting on their own


def decode_backend(kind: bytes, body: bytes) -> str | None:
    if kind == b"T":
        (n,) = struct.unpack_from("!h", body, 0)
        pos, names = 2, []
        for _ in range(n):
            name, pos = cstr(body, pos)
            names.append(name)
            pos += 18
        return "COLUMNS  " + ", ".join(names)
    if kind == b"R":
        (code,) = struct.unpack_from("!i", body, 0)
        return {
            0: "LOGIN  ok",
            3: "LOGIN  password asked (clear text)",
            5: "LOGIN  password asked (md5)",
            10: "LOGIN  password asked (SCRAM)",
            11: "LOGIN  SCRAM challenge",
            12: "LOGIN  SCRAM verified",
        }.get(code, f"LOGIN  method {code}")
    if kind == b"S":
        name, pos = cstr(body, 0)
        value, _ = cstr(body, pos)
        return f"SERVER  {name} {value}" if name in ("server_version", "TimeZone") else None
    if kind == b"C":
        tag, _ = cstr(body, 0)
        return f"DONE  {tag}"
    if kind == b"E":
        fields, pos = {}, 0
        while pos < len(body) and body[pos] != 0:
            code = chr(body[pos])
            value, pos = cstr(body, pos + 1)
            fields[code] = value
        return f"ERROR  {fields.get('C', '')} {fields.get('M', '')}".rstrip()
    return None  # ReadyForQuery, ParameterStatus, auth: skipped


ROWS_SHOWN = 20  # per result; the rest is counted


def decode_row(body: bytes) -> str:
    """A DataRow in text format: the column values, as they came back."""
    (n,) = struct.unpack_from("!h", body, 0)
    pos, values = 2, []
    for _ in range(n):
        (length,) = struct.unpack_from("!i", body, pos)
        pos += 4
        if length < 0:
            values.append(None)
        else:
            values.append(body[pos : pos + length])
            pos += length
    return "ROW  " + ", ".join(fmt_param(v) for v in values)


class PgStream:
    """One direction of one connection: a buffer and the decoder state."""

    def __init__(self, frontend: bool) -> None:
        self.frontend = frontend
        self.buf = b""
        self.started = not frontend  # the client opens with an untyped startup message
        self.rows = 0
        # The server answers an SSL request with one bare byte ('N' or 'S'), no length.
        self.ssl_replies_due = 0

    def feed(self, data: bytes) -> list[str]:
        self.buf += data
        out: list[str] = []
        while True:
            if not self.started:
                if len(self.buf) < 8:
                    return out
                (length, code) = struct.unpack_from("!ii", self.buf, 0)
                if len(self.buf) < length:
                    return out
                body, self.buf = self.buf[8:length], self.buf[length:]
                if code in (SSL_REQUEST, GSSENC_REQUEST):
                    out.append("SSL request (the server is asked for TLS)")
                    continue
                if code == CANCEL_REQUEST:
                    out.append("CANCEL request")
                    continue
                if code == PROTOCOL_3:
                    parts = body.split(b"\x00")
                    kv = dict(zip(parts[0::2], parts[1::2]))
                    user = kv.get(b"user", b"").decode()
                    db = kv.get(b"database", b"").decode() or user
                    out.append(f"CONNECT  user={user} database={db}")
                self.started = True
                continue
            if self.ssl_replies_due and self.buf:
                answer, self.buf = self.buf[0:1], self.buf[1:]
                self.ssl_replies_due -= 1
                out.append("TLS accepted" if answer == b"S" else "no TLS, plain connection")
                continue
            if len(self.buf) < 5:
                return out
            kind = self.buf[0:1]
            (length,) = struct.unpack_from("!i", self.buf, 1)
            if len(self.buf) < 1 + length:
                return out
            body, self.buf = self.buf[5 : 1 + length], self.buf[1 + length :]
            if self.frontend:
                line = decode_frontend(kind, body)
            else:
                if kind == b"D":
                    self.rows += 1
                    if self.rows <= ROWS_SHOWN:
                        out.append(decode_row(body))
                    elif self.rows == ROWS_SHOWN + 1:
                        out.append(f"ROW  … (more rows, counted below)")
                    continue
                line = decode_backend(kind, body)
                if line and line.startswith("DONE"):
                    line += f"  ({self.rows} row{'s' if self.rows != 1 else ''} returned)" if self.rows else ""
                    self.rows = 0
            if line:
                out.append(line)


class PgWire:
    def __init__(self) -> None:
        self.streams: dict[tuple[str, bool], PgStream] = {}

    def tcp_message(self, flow: tcp.TCPFlow) -> None:
        msg = flow.messages[-1]
        key = (flow.id, msg.from_client)
        stream = self.streams.setdefault(key, PgStream(frontend=msg.from_client))
        try:
            lines = stream.feed(msg.content)
            if msg.from_client:
                asked = sum(1 for line in lines if line.startswith("SSL request"))
                if asked:
                    server = self.streams.setdefault((flow.id, False), PgStream(frontend=False))
                    server.ssl_replies_due += asked
        except Exception as e:  # not Postgres, or a protocol we don't know: leave it raw
            lines = [f"(could not decode: {e})"]
        arrow = "→" if msg.from_client else "←"
        # Per message, for the content view: index in flow.messages → its lines.
        by_message = flow.metadata.setdefault("pgwire_messages", {})
        by_message[len(flow.messages) - 1] = [f"{arrow} {line}" for line in lines]
        if lines:
            log = flow.metadata.setdefault("pgwire", [])
            for line in lines:
                log.append(f"{arrow} {line}")
                logging.info(f"[postgres {flow.id[:8]}] {arrow} {line}")
            flow.comment = "\n".join(log[-60:])

    def tcp_end(self, flow: tcp.TCPFlow) -> None:
        self.streams.pop((flow.id, True), None)
        self.streams.pop((flow.id, False), None)


class PostgresView(contentviews.View):
    """Stream Data in mitmweb: each TCP message of a Postgres flow, decoded."""

    name = "Postgres"

    @staticmethod
    def _lines(flow, tcp_message) -> list[str] | None:
        if not isinstance(flow, tcp.TCPFlow) or tcp_message is None:
            return None
        decoded = flow.metadata.get("pgwire_messages")
        if decoded is None:
            return None
        index = next((i for i, m in enumerate(flow.messages) if m is tcp_message), None)
        return decoded.get(index) if index is not None else None

    def __call__(self, data, *, flow=None, tcp_message=None, **metadata):
        lines = self._lines(flow, tcp_message)
        if lines is None:
            return "Postgres", contentviews.format_text("(not decoded)")
        if not lines:
            # A message that only completes in the next chunk, or one we skip (Sync, Execute, …).
            return "Postgres", iter([[("text", "(protocol bookkeeping: sync, execute, ready; no SQL here)")]])
        return "Postgres", iter([[("text", line)] for line in lines])

    def render_priority(self, data, *, flow=None, tcp_message=None, **metadata) -> float:
        return 2.0 if self._lines(flow, tcp_message) is not None else 0.0


view = PostgresView()


def load(loader) -> None:
    contentviews.add(view)


def done() -> None:
    contentviews.remove(view)


addons = [PgWire()]
