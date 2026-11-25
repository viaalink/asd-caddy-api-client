"""
mitmproxy addon: read the Redis protocol (RESP2 and RESP3) in TCP flows.

Part of @viaalink/caddy-api-client (MIT). Load it with
`mitmweb --mode reverse:tcp://<redis host>:6379@<port> -s rediswire.py`; the
library's mitmproxyAddonPath("rediswire") gives its path inside the package.

Client messages become the commands that were sent, with their arguments
(array and inline commands, pipelined or not); server messages become a short
summary of each reply: its type, its length and the first values. In mitmweb's
Stream Data tab each TCP message shows decoded (the "Redis" content view,
picked automatically), the Comment tab holds the whole session as one
transcript, and every line is logged too.

Passwords: AUTH, HELLO ... AUTH, MIGRATE ... AUTH/AUTH2, CONFIG SET of
requirepass/masterauth and the passwords of ACL SETUSER are never shown, and
the TCP messages that carried them are blanked in the stored flow once they
have been forwarded, so mitmweb's Raw view does not show them either.

Plain connections only: a client that starts with TLS is reported as such and
not decoded.

Replies can be split over TCP chunks or several can share one chunk, so every
flow keeps a buffer per direction and only complete values are decoded.

The addon only takes flows that look like Redis (the client speaks first, with
a RESP array or an inline command), so it can be loaded next to pgwire.py and
mysqlwire.py in one mitmproxy.
"""
from __future__ import annotations

import logging

from mitmproxy import contentviews, tcp

NAME = "rediswire"
ARGS_SHOWN = 8  # per command; the rest is counted
ITEMS_SHOWN = 5  # per aggregate reply; the rest is counted
TEXT_SHOWN = 60  # characters of one value


class Incomplete(Exception):
    """The buffer ends inside a value: wait for more bytes."""


WHITESPACE = str.maketrans("", "", "\r\n\t")


def fmt_value(value: bytes | None, limit: int = TEXT_SHOWN) -> str:
    if value is None:
        return "nil"
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


# ─── RESP parsing ──────────────────────────────────────────────────────────


def _line(buf: bytes, pos: int) -> tuple[bytes, int]:
    end = buf.find(b"\r\n", pos)
    if end < 0:
        raise Incomplete
    return buf[pos:end], end + 2


def parse(buf: bytes, pos: int = 0) -> tuple[tuple, int]:
    """
    One RESP2/RESP3 value from buf[pos:]: (value, next position), or Incomplete.
    A value is a tuple whose first item names its type.
    """
    if pos >= len(buf):
        raise Incomplete
    kind = buf[pos : pos + 1]
    line, pos = _line(buf, pos + 1)
    if kind == b"+":
        return ("simple", line.decode("utf-8", "replace")), pos
    if kind == b"-":
        return ("error", line.decode("utf-8", "replace")), pos
    if kind == b":":
        return ("int", int(line)), pos
    if kind == b",":
        return ("double", line.decode()), pos
    if kind == b"(":
        return ("bignum", line.decode()), pos
    if kind == b"#":
        return ("bool", line == b"t"), pos
    if kind == b"_":
        return ("null",), pos
    if kind in (b"$", b"!", b"="):
        n = int(line)
        if n < 0:
            return ("null",), pos
        if len(buf) < pos + n + 2:
            raise Incomplete
        data = buf[pos : pos + n]
        pos += n + 2
        if kind == b"!":
            return ("error", data.decode("utf-8", "replace")), pos
        if kind == b"=":
            return ("bulk", data[4:]), pos  # "txt:" / "mkd:" prefix
        return ("bulk", data), pos
    if kind in (b"*", b"~", b">", b"%", b"|"):
        n = int(line)
        if n < 0:
            return ("null",), pos
        count = n * 2 if kind in (b"%", b"|") else n
        items = []
        for _ in range(count):
            item, pos = parse(buf, pos)
            items.append(item)
        if kind == b"|":
            # Attributes describe the reply that follows them: skip to that one.
            return parse(buf, pos)
        name = {b"*": "array", b"~": "set", b">": "push", b"%": "map"}[kind]
        return (name, items), pos
    raise ValueError(f"not RESP (type byte {kind!r})")


def summary(value: tuple, limit: int = TEXT_SHOWN) -> str:
    """A short, one-line rendering of a reply value."""
    kind = value[0]
    if kind == "simple":
        return value[1]
    if kind == "error":
        return value[1]
    if kind in ("int", "double", "bignum"):
        return str(value[1])
    if kind == "bool":
        return "true" if value[1] else "false"
    if kind == "null":
        return "nil"
    if kind == "bulk":
        return fmt_value(value[1], limit)
    items = value[1]
    if kind == "map":
        pairs = list(zip(items[0::2], items[1::2]))
        shown = ", ".join(f"{summary(k, 30)}={summary(v, 30)}" for k, v in pairs[:ITEMS_SHOWN])
        return f"{{{shown}{', …' if len(pairs) > ITEMS_SHOWN else ''}}}"
    shown = ", ".join(summary(i, 30) for i in items[:ITEMS_SHOWN])
    return f"[{shown}{', …' if len(items) > ITEMS_SHOWN else ''}]"


def describe_reply(value: tuple) -> str:
    kind = value[0]
    if kind == "simple":
        return value[1]  # OK, PONG, QUEUED, …
    if kind == "error":
        return f"ERROR  {value[1]}"
    if kind == "int":
        return f"INTEGER  {value[1]}"
    if kind == "double":
        return f"DOUBLE  {value[1]}"
    if kind == "bignum":
        return f"BIGNUM  {value[1]}"
    if kind == "bool":
        return f"BOOLEAN  {summary(value)}"
    if kind == "null":
        return "NIL"
    if kind == "bulk":
        n = len(value[1])
        shown = fmt_value(value[1])
        return f"STRING  {shown}" if shown.endswith("bytes)") else f"STRING  {shown}  ({n} byte{'s' if n != 1 else ''})"
    items = value[1]
    if kind == "map":
        n = len(items) // 2
        return f"MAP  {n} entr{'ies' if n != 1 else 'y'}: {summary(value)}"
    label = {"array": "ARRAY", "set": "SET", "push": "PUSH"}[kind]
    n = len(items)
    return f"{label}  {n} item{'s' if n != 1 else ''}: {summary(value)}"


# ─── commands ──────────────────────────────────────────────────────────────

HIDDEN = "(credentials not shown)"


def describe_command(args: list[bytes]) -> tuple[str, bool]:
    """A command line for the transcript, and whether it carried a secret."""
    if not args:
        return "(empty command)", False
    name = args[0].decode("utf-8", "replace").upper()
    rest = args[1:]
    shown: list[str] | None = None
    secret = False
    upper = [a.decode("utf-8", "replace").upper() for a in rest]
    if name == "AUTH":
        shown, secret = [HIDDEN], True
    elif name == "HELLO":
        shown = []
        i = 0
        while i < len(rest):
            if upper[i] == "AUTH":
                shown.append("AUTH " + HIDDEN)
                secret = True
                i += 3
            elif upper[i] == "SETNAME" and i + 1 < len(rest):
                shown += ["SETNAME", fmt_value(rest[i + 1])]
                i += 2
            else:
                shown.append(rest[i].decode("utf-8", "replace"))
                i += 1
    elif name == "MIGRATE" and ("AUTH" in upper or "AUTH2" in upper):
        cut = min(upper.index(k) for k in ("AUTH", "AUTH2") if k in upper)
        shown = [fmt_value(a) for a in rest[:cut]] + [upper[cut], HIDDEN]
        secret = True
    elif name == "CONFIG" and upper[:1] == ["SET"]:
        shown = ["SET"]
        for key, value in zip(rest[1::2], rest[2::2]):
            k = key.decode("utf-8", "replace")
            if k.lower() in ("requirepass", "masterauth", "masteruser"):
                shown += [k, HIDDEN]
                secret = True
            else:
                shown += [k, fmt_value(value)]
    elif name == "ACL" and upper[:1] == ["SETUSER"]:
        shown = ["SETUSER"] + [fmt_value(a) for a in rest[1:2]]
        for rule in rest[2:]:
            if rule[:1] in (b">", b"#", b"<", b"!"):
                shown.append(HIDDEN)
                secret = True
            else:
                shown.append(rule.decode("utf-8", "replace"))
    if shown is None:
        shown = [fmt_value(a) for a in rest[:ARGS_SHOWN]]
        if len(rest) > ARGS_SHOWN:
            shown.append(f"… ({len(rest) - ARGS_SHOWN} more)")
        # A subcommand reads better as a word: CLIENT SETNAME, CONFIG GET, …
        if name in ("CLIENT", "CONFIG", "ACL", "CLUSTER", "COMMAND", "MEMORY", "OBJECT",
                    "SCRIPT", "FUNCTION", "XINFO", "XGROUP", "MODULE", "LATENCY", "SLOWLOG") and rest:
            shown[0] = upper[0]
    return f"{name}  {' '.join(shown)}".rstrip(), secret


def parse_command(buf: bytes, pos: int) -> tuple[list[bytes], int]:
    """One client command: a RESP array of bulk strings, or an inline command."""
    if pos >= len(buf):
        raise Incomplete
    if buf[pos : pos + 1] == b"*":
        value, end = parse(buf, pos)
        if value[0] == "null":
            return [], end
        if value[0] != "array" or any(v[0] != "bulk" for v in value[1]):
            raise ValueError("a command must be an array of bulk strings")
        return [v[1] for v in value[1]], end
    line, end = _line(buf, pos)
    return line.split(), end


# ─── one connection ────────────────────────────────────────────────────────


def looks_like_redis(first_client_bytes: bytes) -> bool | None:
    """
    Does a flow that the client opened with these bytes speak RESP?
    None: too few bytes yet to tell.
    """
    data = first_client_bytes
    if not data:
        return None
    if data[:1] == b"\x16":
        return True  # TLS: reported as such
    if data[:1] == b"*":
        if len(data) < 2:
            return None
        return data[1:2].isdigit() or data[1:2] == b"-"
    line, crlf, _ = data.partition(b"\r\n")
    word = line.split(b" ", 1)[0]
    if not crlf:
        # An inline command still coming in: undecided while it can still be one.
        if len(data) > 4096 or (b" " in line and not word.isalpha()):
            return False
        return None if word.isalpha() or not word else False
    if not word.isalpha() or len(word) > 20:
        return False
    # Inline commands, but not other text protocols on a TCP port.
    return b" HTTP/" not in line


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

    def take(self, n: int) -> list[int]:
        """Consume n bytes; return the indexes of the messages they came from."""
        first, last = self.start, self.start + n
        indexes = [i for i, a, b in self.chunks if a < last and b > first]
        self.buf, self.start = self.buf[n:], last
        self.chunks = [c for c in self.chunks if c[2] > last]
        return indexes


class RedisConnection:
    """Both directions of one Redis connection."""

    def __init__(self) -> None:
        self.client = Direction()
        self.server = Direction()
        self.tls = False
        self.broken = False

    def feed(self, data: bytes, from_client: bool, index: int) -> tuple[list[str], set[int]]:
        """Decode what is complete; return the lines and the message indexes holding secrets."""
        lines: list[str] = []
        secret: set[int] = set()
        if self.tls or self.broken:
            return lines, secret
        side = self.client if from_client else self.server
        if from_client and side.start == 0 and not side.buf and data[:1] == b"\x16":
            self.tls = True
            return ["TLS handshake: the connection is encrypted, not decoded"], secret
        side.add(data, index)
        while side.buf:
            try:
                if from_client:
                    args, end = parse_command(side.buf, 0)
                    line, has_secret = describe_command(args)
                else:
                    value, end = parse(side.buf, 0)
                    line, has_secret = describe_reply(value), False
            except Incomplete:
                break
            except (ValueError, IndexError) as e:
                self.broken = True
                lines.append(f"(could not decode: {e}; the rest of this connection is left raw)")
                break
            indexes = side.take(end)
            if has_secret:
                secret.update(indexes)
            lines.append(line)
        return lines, secret


# ─── the addon ─────────────────────────────────────────────────────────────


class RedisWire:
    def __init__(self) -> None:
        self.connections: dict[str, RedisConnection | None] = {}

    @staticmethod
    def _hide_secrets(flow: tcp.TCPFlow, keep_last: bool) -> None:
        """
        Blank messages that carried a password once they have been forwarded,
        so mitmweb's Raw and Auto views never show it. A message is sent when
        its tcp_message hook returns; only the stored copy is changed here.
        """
        pending = flow.metadata.get(f"{NAME}_hide", [])
        last = len(flow.messages) - 1
        for index in [i for i in pending if not (keep_last and i == last)]:
            message = flow.messages[index]
            message.content = f"({NAME}: message with credentials hidden, {len(message.content)} bytes)".encode()
            pending.remove(index)

    def _claim(self, flow: tcp.TCPFlow) -> list[int]:
        """
        The indexes of the messages to decode now: the last one, or every one
        so far when this message is the one that shows the flow is Redis.
        """
        if flow.id in self.connections:
            return [len(flow.messages) - 1] if self.connections[flow.id] else []
        claimed = flow.metadata.get("wire_protocol")
        if claimed not in (None, "redis") or not flow.messages[0].from_client:
            verdict: bool | None = False
        else:
            verdict = looks_like_redis(b"".join(m.content for m in flow.messages if m.from_client))
        if verdict is None:
            return []  # wait for more bytes
        self.connections[flow.id] = RedisConnection() if verdict else None
        if not verdict:
            return []
        flow.metadata["wire_protocol"] = "redis"
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
            conn.broken = True
            lines, secret = [f"(could not decode: {e})"], set()
        arrow = "→" if msg.from_client else "←"
        by_message = flow.metadata.setdefault(f"{NAME}_messages", {})
        by_message[index] = [f"{arrow} {line}" for line in lines]
        if secret:
            pending = flow.metadata.setdefault(f"{NAME}_hide", [])
            pending.extend(i for i in sorted(secret) if i not in pending)
            # Earlier chunks of a split command are out already: blank them now.
            self._hide_secrets(flow, keep_last=True)
        if lines:
            log = flow.metadata.setdefault(NAME, [])
            for line in lines:
                log.append(f"{arrow} {line}")
                logging.info(f"[redis {flow.id[:8]}] {arrow} {line}")
            flow.comment = "\n".join(log[-60:])

    def tcp_end(self, flow: tcp.TCPFlow) -> None:
        if self.connections.pop(flow.id, None) is not None:
            self._hide_secrets(flow, keep_last=False)

    def tcp_error(self, flow: tcp.TCPFlow) -> None:
        self.tcp_end(flow)


def _decoded_lines(flow, tcp_message) -> list[str] | None:
    """The rediswire lines of one TCP message, or None when it is not a decoded Redis flow."""
    if not isinstance(flow, tcp.TCPFlow) or tcp_message is None:
        return None
    decoded = flow.metadata.get(f"{NAME}_messages")
    if decoded is None:
        return None
    index = next((i for i, m in enumerate(flow.messages) if m is tcp_message), None)
    return decoded.get(index) if index is not None else None


PARTIAL = "(part of a command or reply that continues in the next message)"


if hasattr(contentviews, "Contentview"):
    # mitmproxy 12 and later: prettify() returns text, Metadata carries the flow.

    class RedisView(contentviews.Contentview):
        """Stream Data in mitmweb: each TCP message of a Redis flow, decoded."""

        @property
        def name(self) -> str:
            return "Redis"

        def prettify(self, data: bytes, metadata) -> str:
            lines = _decoded_lines(metadata.flow, metadata.tcp_message)
            if lines is None:
                return "(not decoded)"
            return "\n".join(lines) if lines else PARTIAL

        def render_priority(self, data: bytes, metadata) -> float:
            return 2.0 if _decoded_lines(metadata.flow, metadata.tcp_message) is not None else -1.0

else:
    # mitmproxy 10 and 11: the older View API.

    class RedisView(contentviews.View):  # type: ignore[no-redef]
        """Stream Data in mitmweb: each TCP message of a Redis flow, decoded."""

        name = "Redis"

        def __call__(self, data, *, flow=None, tcp_message=None, **metadata):
            lines = _decoded_lines(flow, tcp_message)
            if lines is None:
                return "Redis", contentviews.format_text("(not decoded)")
            return "Redis", iter([[("text", line)] for line in (lines or [PARTIAL])])

        def render_priority(self, data, *, flow=None, tcp_message=None, **metadata) -> float:
            return 2.0 if _decoded_lines(flow, tcp_message) is not None else 0.0


view = RedisView()


def load(loader) -> None:
    contentviews.add(view)


def done() -> None:
    # mitmproxy 12 has no way to unregister a view (its remove() is a deprecated no-op).
    if not hasattr(contentviews, "Contentview"):
        contentviews.remove(view)


addons = [RedisWire()]
