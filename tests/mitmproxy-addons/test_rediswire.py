"""rediswire.py on recorded RESP2/RESP3 byte sequences."""
from __future__ import annotations

import unittest

from helpers import bytewise, load_addon, play

rediswire = load_addon("rediswire")
SECRET = "Redis-Secret-4711"


def cmd(*args: str | bytes) -> bytes:
    out = f"*{len(args)}\r\n".encode()
    for a in args:
        a = a.encode() if isinstance(a, str) else a
        out += f"${len(a)}\r\n".encode() + a + b"\r\n"
    return out


# A session as redis-cli / ioredis sends it, replies as Redis 7 answers them.
SESSION = [
    (True, cmd("AUTH", SECRET)),
    (False, b"+OK\r\n"),
    (True, cmd("HSET", "product:7", "name", "Wireless Mouse", "price", "29.99") + cmd("EXPIRE", "product:7", "60")),
    (False, b":2\r\n:1\r\n"),
    (True, cmd("HGETALL", "product:7")),
    (False, b"*4\r\n$4\r\nname\r\n$14\r\nWireless Mouse\r\n$5\r\nprice\r\n$5\r\n29.99\r\n"),
    (True, cmd("GET", "cart:42")),
    (False, b"$-1\r\n"),
    (True, cmd("ZREVRANGE", "bestsellers", "0", "2")),
    (False, b"*3\r\n$8\r\nkeyboard\r\n$5\r\nmouse\r\n$3\r\nhub\r\n"),
    (True, cmd("INCR", "product:7")),
    (False, b"-WRONGTYPE Operation against a key holding the wrong kind of value\r\n"),
    (True, b"PING\r\n"),
    (False, b"+PONG\r\n"),
]

EXPECTED = [
    "→ AUTH  (credentials not shown)",
    "← OK",
    "→ HSET  'product:7' 'name' 'Wireless Mouse' 'price' '29.99'",
    "→ EXPIRE  'product:7' '60'",
    "← INTEGER  2",
    "← INTEGER  1",
    "→ HGETALL  'product:7'",
    "← ARRAY  4 items: ['name', 'Wireless Mouse', 'price', '29.99']",
    "→ GET  'cart:42'",
    "← NIL",
    "→ ZREVRANGE  'bestsellers' '0' '2'",
    "← ARRAY  3 items: ['keyboard', 'mouse', 'hub']",
    "→ INCR  'product:7'",
    "← ERROR  WRONGTYPE Operation against a key holding the wrong kind of value",
    "→ PING",
    "← PONG",
]


def stored(flow) -> bytes:
    return b"".join(m.content for m in flow.messages)


class TranscriptTest(unittest.TestCase):
    def addon(self):
        return rediswire.RedisWire()

    def test_session_in_whole_messages(self):
        flow = play([self.addon()], SESSION)
        self.assertEqual(flow.comment.split("\n"), EXPECTED)
        self.assertEqual(flow.metadata["wire_protocol"], "redis")

    def test_every_byte_its_own_message(self):
        flow = play([self.addon()], bytewise(SESSION))
        self.assertEqual(flow.comment.split("\n"), EXPECTED)

    def test_everything_in_one_chunk_per_direction(self):
        client = b"".join(d for c, d in SESSION if c)
        server = b"".join(d for c, d in SESSION if not c)
        flow = play([self.addon()], [(True, client), (False, server)])
        self.assertEqual(
            [l for l in flow.comment.split("\n") if l.startswith("→")], [l for l in EXPECTED if l.startswith("→")]
        )
        self.assertEqual(
            [l for l in flow.comment.split("\n") if l.startswith("←")], [l for l in EXPECTED if l.startswith("←")]
        )

    def test_content_view_lines_per_message(self):
        flow = play([self.addon()], SESSION)
        lines = flow.metadata["rediswire_messages"]
        self.assertEqual(lines[2], ["→ HSET  'product:7' 'name' 'Wireless Mouse' 'price' '29.99'", "→ EXPIRE  'product:7' '60'"])
        self.assertEqual(lines[3], ["← INTEGER  2", "← INTEGER  1"])

    def test_resp3_replies(self):
        flow = play(
            [self.addon()],
            [
                (True, cmd("HELLO", "3")),
                (
                    False,
                    b"%3\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.4.1\r\n$5\r\nproto\r\n:3\r\n",
                ),
                (True, cmd("HGETALL", "product:7")),
                (False, b"%1\r\n$4\r\nname\r\n$5\r\nMouse\r\n"),
                (True, cmd("SMEMBERS", "tags") + cmd("GET", "x") + cmd("ZSCORE", "z", "m")),
                (False, b"~2\r\n+a\r\n+b\r\n_\r\n,3.5\r\n"),
                (True, cmd("EXISTS", "x") + cmd("INFO")),
                (False, b"#f\r\n|1\r\n+ttl\r\n:3\r\n=9\r\ntxt:hello\r\n"),
                (False, b">3\r\n$7\r\nmessage\r\n$4\r\nnews\r\n$2\r\nhi\r\n!21\r\nSYNTAX invalid syntax\r\n"),
            ],
        )
        self.assertEqual(
            flow.comment.split("\n"),
            [
                "→ HELLO  3",
                "← MAP  3 entries: {'server'='redis', 'version'='7.4.1', 'proto'=3}",
                "→ HGETALL  'product:7'",
                "← MAP  1 entry: {'name'='Mouse'}",
                "→ SMEMBERS  'tags'",
                "→ GET  'x'",
                "→ ZSCORE  'z' 'm'",
                "← SET  2 items: [a, b]",
                "← NIL",
                "← DOUBLE  3.5",
                "→ EXISTS  'x'",
                "→ INFO",
                "← BOOLEAN  false",
                "← STRING  'hello'  (5 bytes)",
                "← PUSH  3 items: ['message', 'news', 'hi']",
                "← ERROR  SYNTAX invalid syntax",
            ],
        )

    def test_multi_line_text_stays_text(self):
        info = b"# Server\r\nredis_version:7.4.1\r\n" + b"x" * 100
        flow = play([self.addon()], [(True, cmd("INFO")), (False, b"$%d\r\n%s\r\n" % (len(info), info))])
        self.assertEqual(
            flow.comment.split("\n")[1],
            "← STRING  '# Server\\r\\nredis_version:7.4.1\\r\\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'… (131 bytes)",
        )

    def test_long_and_binary_values_are_cut(self):
        flow = play(
            [self.addon()],
            [(True, cmd("SET", "blob", b"\x00\x01\x02" * 40) + cmd("SET", "long", "x" * 200))],
        )
        lines = flow.comment.split("\n")
        self.assertTrue(lines[0].startswith("→ SET  'blob' 0x000102"), lines[0])
        self.assertIn("(120 bytes)", lines[0])
        self.assertIn("(200 bytes)", lines[1])


class SecretsTest(unittest.TestCase):
    def check_hidden(self, flow, marker: str):
        self.assertNotIn(SECRET, flow.comment)
        self.assertNotIn(SECRET.encode(), stored(flow))
        self.assertIn(marker, flow.comment)
        self.assertIn(b"(rediswire: message with credentials hidden", stored(flow))

    def test_auth_blanked_in_the_stored_flow(self):
        flow = play([rediswire.RedisWire()], SESSION)
        self.check_hidden(flow, "→ AUTH  (credentials not shown)")
        # Only the message with the password: the rest stays as it was.
        self.assertEqual(flow.messages[2].content, SESSION[2][1])

    def test_auth_with_user_split_over_every_byte(self):
        chunks = bytewise([(True, cmd("AUTH", "shop", SECRET)), (False, b"+OK\r\n")])
        flow = play([rediswire.RedisWire()], chunks)
        self.check_hidden(flow, "→ AUTH  (credentials not shown)")

    def test_hidden_once_forwarded_not_before(self):
        # mitmproxy forwards a message after tcp_message returns: changing it
        # in the hook would change what Redis receives.
        addon = rediswire.RedisWire()
        flow = play([addon], [(True, cmd("AUTH", SECRET))], end=False)
        self.assertIn(SECRET.encode(), flow.messages[0].content)
        addon.tcp_end(flow)
        self.assertNotIn(SECRET.encode(), flow.messages[0].content)

    def test_hello_auth(self):
        flow = play(
            [rediswire.RedisWire()],
            [(True, cmd("HELLO", "3", "AUTH", "default", SECRET, "SETNAME", "shop-api")), (False, b"%0\r\n")],
        )
        self.check_hidden(flow, "→ HELLO  3 AUTH (credentials not shown) SETNAME 'shop-api'")

    def test_inline_auth(self):
        flow = play([rediswire.RedisWire()], [(True, f"AUTH {SECRET}\r\n".encode()), (False, b"+OK\r\n")])
        self.check_hidden(flow, "→ AUTH  (credentials not shown)")

    def test_config_set_requirepass_acl_setuser_migrate(self):
        flow = play(
            [rediswire.RedisWire()],
            [
                (True, cmd("CONFIG", "SET", "requirepass", SECRET, "maxmemory", "100mb")),
                (True, cmd("ACL", "SETUSER", "shop", "on", ">" + SECRET, "~cart:*", "+get")),
                (True, cmd("MIGRATE", "h", "6379", "k", "0", "5000", "AUTH2", "u", SECRET)),
            ],
        )
        self.assertEqual(
            flow.comment.split("\n"),
            [
                "→ CONFIG  SET requirepass (credentials not shown) maxmemory '100mb'",
                "→ ACL  SETUSER 'shop' on (credentials not shown) ~cart:* +get",
                "→ MIGRATE  'h' '6379' 'k' '0' '5000' AUTH2 (credentials not shown)",
            ],
        )
        self.assertNotIn(SECRET.encode(), stored(flow))


class ClaimTest(unittest.TestCase):
    def test_postgres_and_mysql_flows_are_left_alone(self):
        pg_startup = b"\x00\x00\x00\x08\x04\xd2\x16\x2f"
        mysql_greeting = b"\x4a\x00\x00\x00\x0a8.4.3\x00"
        for chunks in ([(True, pg_startup)], [(False, mysql_greeting), (True, b"abc")]):
            flow = play([rediswire.RedisWire()], chunks)
            self.assertEqual(flow.comment, "")
            self.assertNotIn("rediswire_messages", flow.metadata)

    def test_http_is_not_an_inline_command(self):
        flow = play([rediswire.RedisWire()], [(True, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")])
        self.assertEqual(flow.comment, "")

    def test_tls_is_reported_not_decoded(self):
        flow = play([rediswire.RedisWire()], [(True, b"\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03"), (False, b"\x16\x03\x03")])
        self.assertEqual(flow.comment, "→ TLS handshake: the connection is encrypted, not decoded")

    def test_garbage_after_a_good_start_is_reported_once(self):
        flow = play([rediswire.RedisWire()], [(True, cmd("PING")), (False, b"?what\r\n"), (False, b"+OK\r\n")])
        lines = flow.comment.split("\n")
        self.assertEqual(lines[0], "→ PING")
        self.assertTrue(lines[1].startswith("← (could not decode"), lines)
        self.assertEqual(len(lines), 2)


if __name__ == "__main__":
    unittest.main()
