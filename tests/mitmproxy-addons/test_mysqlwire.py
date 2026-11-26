"""mysqlwire.py on recorded MySQL 8 / MariaDB 11 byte sequences."""
from __future__ import annotations

import struct
import unittest

from helpers import bytewise, load_addon, play

mysqlwire = load_addon("mysqlwire")
pgwire = load_addon("pgwire")
rediswire = load_addon("rediswire")

# Capabilities as MySQL 8.4 offers them and mysql2 (Node) takes them.
SERVER_CAPS = 0xDFFFFFFF
CLIENT_CAPS = 0x000FA68F | 0x00100000 | 0x01000000 | 0x00200000  # protocol 41, plugin auth, attrs, deprecate eof, lenenc
CLIENT_CAPS_EOF = CLIENT_CAPS & ~0x01000000  # an older client: EOF packets
AUTH_RESPONSE = bytes(range(0xA0, 0xA0 + 32))  # the scrambled password: must never be stored


def pkt(seq: int, payload: bytes) -> bytes:
    return len(payload).to_bytes(3, "little") + bytes([seq]) + payload


def lenenc(n: int) -> bytes:
    if n < 0xFB:
        return bytes([n])
    if n < 1 << 16:
        return b"\xfc" + n.to_bytes(2, "little")
    if n < 1 << 24:
        return b"\xfd" + n.to_bytes(3, "little")
    return b"\xfe" + n.to_bytes(8, "little")


def lstr(s: str | bytes) -> bytes:
    b = s.encode() if isinstance(s, str) else s
    return lenenc(len(b)) + b


def greeting(version: str, plugin: str = "caching_sha2_password", caps: int = SERVER_CAPS) -> bytes:
    nonce = b"0123456789abcdefghij"
    return pkt(
        0,
        b"\x0a"
        + version.encode()
        + b"\x00"
        + struct.pack("<I", 42)
        + nonce[:8]
        + b"\x00"
        + struct.pack("<H", caps & 0xFFFF)
        + b"\xff"
        + struct.pack("<H", 2)
        + struct.pack("<H", caps >> 16)
        + bytes([21])
        + b"\x00" * 10
        + nonce[8:]
        + b"\x00"
        + plugin.encode()
        + b"\x00",
    )


def handshake_response(user: str, db: str, caps: int = CLIENT_CAPS, plugin: str = "caching_sha2_password") -> bytes:
    body = struct.pack("<IIB", caps, 0xFFFFFF, 45) + b"\x00" * 23 + user.encode() + b"\x00"
    body += lstr(AUTH_RESPONSE) + db.encode() + b"\x00" + plugin.encode() + b"\x00"
    body += lstr(lstr("_client_name") + lstr("Node-MySQL-2"))
    return pkt(1, body)


def ok(seq: int, affected: int = 0, insert_id: int = 0, status: int = 2, header: bytes = b"\x00", info: bytes = b"") -> bytes:
    return pkt(seq, header + lenenc(affected) + lenenc(insert_id) + struct.pack("<HH", status, 0) + info)


def eof(seq: int, status: int = 2) -> bytes:
    return pkt(seq, b"\xfe" + struct.pack("<HH", 0, status))


def err(seq: int, code: int, state: str, message: str) -> bytes:
    return pkt(seq, b"\xff" + struct.pack("<H", code) + b"#" + state.encode() + message.encode())


def column(seq: int, name: str, kind: int, flags: int = 0) -> bytes:
    body = lstr("def") + lstr("shop") + lstr("products") + lstr("products") + lstr(name) + lstr(name)
    body += b"\x0c" + struct.pack("<HIBHB", 45, 255, kind, flags, 0) + b"\x00\x00"
    return pkt(seq, body)


def text_row(seq: int, *values: str | None) -> bytes:
    return pkt(seq, b"".join(b"\xfb" if v is None else lstr(v) for v in values))


VAR_STRING, NEWDECIMAL, DOUBLE, LONGLONG, LONG = 0xFD, 0xF6, 0x05, 0x08, 0x03

LOGIN = [
    (False, greeting("8.4.3")),
    (True, handshake_response("shop", "shop")),
    (False, pkt(2, b"\x01\x03")),  # caching_sha2_password: fast auth
    (False, ok(3)),
]

QUERY = [
    (True, pkt(0, b"\x03select name, price from products where category = 'electronics' order by rating desc")),
    (False, err(1, 1054, "42S22", "Unknown column 'rating' in 'order clause'")),
    (True, pkt(0, b"\x03select name, price from products where category = 'Electronics' limit 2")),
    (
        False,
        pkt(1, b"\x02")
        + column(2, "name", VAR_STRING)
        + column(3, "price", NEWDECIMAL)
        + text_row(4, "Wireless Mouse", "29.99")
        + text_row(5, "USB-C Hub", None)
        + ok(6, header=b"\xfe"),
    ),
    (True, pkt(0, b"\x03update products set price = 24.99 where id = 4")),
    (False, ok(1, affected=1, info=b"Rows matched: 1  Changed: 1  Warnings: 0")),
    (True, pkt(0, b"\x03insert into orders(product_id) values (4)")),
    (False, ok(1, affected=1, insert_id=17)),
]

SQL = "select name, price from products where category = ? and price <= ? order by price"
STMT_ID = 1
PREPARED = [
    (True, pkt(0, b"\x16" + SQL.encode())),
    (
        False,
        pkt(1, b"\x00" + struct.pack("<IHHBH", STMT_ID, 2, 2, 0, 0))
        + column(2, "?", VAR_STRING)
        + column(3, "?", VAR_STRING)
        + column(4, "name", VAR_STRING)
        + column(5, "price", NEWDECIMAL),
    ),
    (
        True,
        pkt(
            0,
            b"\x17"
            + struct.pack("<IBI", STMT_ID, 0, 1)
            + b"\x00"  # null bitmap
            + b"\x01"  # new parameter types
            + struct.pack("<BB", VAR_STRING, 0)
            + struct.pack("<BB", DOUBLE, 0)
            + lstr("electronics")
            + struct.pack("<d", 200.0),
        ),
    ),
    (False, pkt(1, b"\x02") + column(2, "name", VAR_STRING) + column(3, "price", NEWDECIMAL) + ok(4, header=b"\xfe")),
    (
        True,
        pkt(
            0,
            b"\x17"
            + struct.pack("<IBI", STMT_ID, 0, 1)
            + b"\x00"
            + b"\x00"  # same types as last time
            + lstr("Electronics")
            + struct.pack("<d", 200.5),
        ),
    ),
    (
        False,
        pkt(1, b"\x02")
        + column(2, "name", VAR_STRING)
        + column(3, "price", NEWDECIMAL)
        + pkt(4, b"\x00\x00" + lstr("Wireless Mouse") + lstr("29.99"))
        + pkt(5, b"\x00\x08" + lstr("Mystery box"))  # price NULL: bit 1 + offset 2 = bit 3
        + ok(6, header=b"\xfe"),
    ),
    (True, pkt(0, b"\x17" + struct.pack("<IBI", STMT_ID, 0, 1) + b"\x02" + b"\x01" + struct.pack("<BBBB", VAR_STRING, 0, LONGLONG, 0x80) + lstr("x"))),
    (False, ok(1)),
    (True, pkt(0, b"\x19" + struct.pack("<I", STMT_ID))),
    (True, pkt(0, b"\x01")),
]

EXPECTED = [
    "← SERVER  MySQL 8.4.3  (version string '8.4.3', connection 42, auth caching_sha2_password)",
    "→ CONNECT  user=shop database=shop auth=caching_sha2_password  (credentials not shown)",
    "← LOGIN  fast auth ok (cached)",
    "← LOGIN  ok",
    "→ SQL  select name, price from products where category = 'electronics' order by rating desc",
    "← ERROR  1054 (42S22) Unknown column 'rating' in 'order clause'",
    "→ SQL  select name, price from products where category = 'Electronics' limit 2",
    "← COLUMNS  name, price",
    "← ROW  'Wireless Mouse', '29.99'",
    "← ROW  'USB-C Hub', NULL",
    "← DONE  2 rows returned",
    "→ SQL  update products set price = 24.99 where id = 4",
    "← OK  1 row affected  (Rows matched: 1  Changed: 1  Warnings: 0)",
    "→ SQL  insert into orders(product_id) values (4)",
    "← OK  1 row affected, insert id 17",
    f"→ PREPARE  {SQL}",
    "← PREPARED  stmt 1  (2 parameters, 2 columns)",
    "→ EXECUTE  stmt 1  ?1='electronics', ?2=200",
    "← COLUMNS  name, price",
    "← DONE  0 rows returned",
    "→ EXECUTE  stmt 1  ?1='Electronics', ?2=200.5",
    "← COLUMNS  name, price",
    "← ROW  'Wireless Mouse', '29.99'",
    "← ROW  'Mystery box', NULL",
    "← DONE  2 rows returned",
    "→ EXECUTE  stmt 1  ?1='x', ?2=NULL",
    "← OK  0 rows affected",
    "→ CLOSE  stmt 1",
    "→ QUIT",
]

SESSION = LOGIN + QUERY + PREPARED


def stored(flow) -> bytes:
    return b"".join(m.content for m in flow.messages)


class TranscriptTest(unittest.TestCase):
    def test_session(self):
        flow = play([mysqlwire.MySQLWire()], SESSION)
        self.assertEqual(flow.comment.split("\n"), EXPECTED)
        self.assertEqual(flow.metadata["wire_protocol"], "mysql")

    def test_every_byte_its_own_message(self):
        flow = play([mysqlwire.MySQLWire()], bytewise(SESSION))
        self.assertEqual(flow.comment.split("\n"), EXPECTED)

    def test_all_three_addons_loaded_together(self):
        flow = play([pgwire.PgWire(), rediswire.RedisWire(), mysqlwire.MySQLWire()], bytewise(SESSION))
        self.assertEqual(flow.comment.split("\n"), EXPECTED)
        self.assertNotIn("pgwire_messages", flow.metadata)
        self.assertNotIn("rediswire_messages", flow.metadata)

    def test_content_view_lines_per_message(self):
        flow = play([mysqlwire.MySQLWire()], SESSION)
        lines = flow.metadata["mysqlwire_messages"]
        self.assertEqual(lines[7], ["← COLUMNS  name, price", "← ROW  'Wireless Mouse', '29.99'", "← ROW  'USB-C Hub', NULL", "← DONE  2 rows returned"])

    def test_eof_packets_of_an_older_client(self):
        login = [
            (False, greeting("8.0.40", "mysql_native_password")),
            (True, handshake_response("shop", "shop", CLIENT_CAPS_EOF, "mysql_native_password")),
            (False, ok(2)),
        ]
        query = [
            (True, pkt(0, b"\x03select name from products")),
            (False, pkt(1, b"\x01") + column(2, "name", VAR_STRING) + eof(3) + text_row(4, "Cookbook") + eof(5)),
            (True, pkt(0, b"\x16select ? + 1")),
            (False, pkt(1, b"\x00" + struct.pack("<IHHBH", 9, 1, 1, 0, 0)) + column(2, "?", LONGLONG) + eof(3) + column(4, "x", LONGLONG) + eof(5)),
            (True, pkt(0, b"\x17" + struct.pack("<IBI", 9, 0, 1) + b"\x00\x01" + struct.pack("<BB", LONGLONG, 0) + struct.pack("<q", -5))),
            (False, pkt(1, b"\x01") + column(2, "x", LONGLONG) + eof(3) + pkt(4, b"\x00\x00" + struct.pack("<q", -4)) + eof(5)),
            (True, pkt(0, b"\x0e")),
            (False, ok(1)),
        ]
        flow = play([mysqlwire.MySQLWire()], bytewise(login + query))
        self.assertEqual(
            flow.comment.split("\n")[3:],
            [
                "→ SQL  select name from products",
                "← COLUMNS  name",
                "← ROW  'Cookbook'",
                "← DONE  1 row returned",
                "→ PREPARE  select ? + 1",
                "← PREPARED  stmt 9  (1 parameter, 1 column)",
                "→ EXECUTE  stmt 9  ?1=-5",
                "← COLUMNS  x",
                "← ROW  -4",
                "← DONE  1 row returned",
                "→ PING",
                "← OK  0 rows affected",
            ],
        )

    def test_multi_results(self):
        more = 2 | 8  # SERVER_MORE_RESULTS_EXISTS
        flow = play(
            [mysqlwire.MySQLWire()],
            LOGIN
            + [
                (True, pkt(0, b"\x03call top_products()")),
                (
                    False,
                    pkt(1, b"\x01") + column(2, "name", VAR_STRING) + text_row(3, "Keyboard")
                    + ok(4, header=b"\xfe", status=more) + ok(5, status=2),
                ),
            ],
        )
        self.assertEqual(
            flow.comment.split("\n")[4:],
            ["→ SQL  call top_products()", "← COLUMNS  name", "← ROW  'Keyboard'", "← DONE  1 row returned", "← OK  0 rows affected"],
        )

    def test_many_rows_are_counted(self):
        rows = b"".join(text_row(3 + i, f"p{i}") for i in range(25))
        flow = play(
            [mysqlwire.MySQLWire()],
            LOGIN + [(True, pkt(0, b"\x03select name from products")), (False, pkt(1, b"\x01") + column(2, "name", VAR_STRING) + rows + ok(28, header=b"\xfe"))],
        )
        lines = flow.comment.split("\n")
        self.assertEqual(sum(1 for l in lines if l.startswith("← ROW  'p")), 20)
        self.assertIn("← ROW  … (more rows, counted below)", lines)
        self.assertEqual(lines[-1], "← DONE  25 rows returned")


class ServerKindTest(unittest.TestCase):
    def first_line(self, version: str) -> str:
        return play([mysqlwire.MySQLWire()], [(False, greeting(version, "mysql_native_password"))]).comment

    def test_mysql_and_mariadb(self):
        self.assertEqual(
            self.first_line("8.0.40"),
            "← SERVER  MySQL 8.0.40  (version string '8.0.40', connection 42, auth mysql_native_password)",
        )
        self.assertEqual(
            self.first_line("11.4.4-MariaDB-ubu2404"),
            "← SERVER  MariaDB 11.4.4  (version string '11.4.4-MariaDB-ubu2404', connection 42, auth mysql_native_password)",
        )
        # MariaDB 10 put a fake 5.5.5- in front, for old clients.
        self.assertTrue(self.first_line("5.5.5-10.11.10-MariaDB-log").startswith("← SERVER  MariaDB 10.11.10"))

    def test_an_error_instead_of_a_greeting(self):
        flow = play([mysqlwire.MySQLWire()], [(False, pkt(0, b"\xff" + struct.pack("<H", 1040) + b"Too many connections"))])
        self.assertEqual(flow.comment, "← ERROR  1040 Too many connections")


class SecretsTest(unittest.TestCase):
    def check_hidden(self, flow):
        self.assertNotIn(AUTH_RESPONSE, stored(flow))
        self.assertNotIn(AUTH_RESPONSE.hex(), flow.comment)
        self.assertIn(b"(mysqlwire: login message hidden", stored(flow))

    def test_auth_response_blanked(self):
        flow = play([mysqlwire.MySQLWire()], SESSION)
        self.check_hidden(flow)
        self.assertEqual(flow.messages[1].content[:len(b"(mysqlwire")], b"(mysqlwire")
        # Queries are not touched.
        self.assertEqual(flow.messages[4].content, QUERY[0][1])

    def test_auth_response_split_over_every_byte(self):
        flow = play([mysqlwire.MySQLWire()], bytewise(LOGIN))
        self.check_hidden(flow)

    def test_hidden_once_forwarded_not_before(self):
        addon = mysqlwire.MySQLWire()
        flow = play([addon], LOGIN[:2], end=False)
        self.assertIn(AUTH_RESPONSE, flow.messages[1].content)  # not sent yet: left alone
        addon.tcp_end(flow)
        self.check_hidden(flow)

    def test_full_authentication_with_rsa(self):
        secret = b"RSA-encrypted-password-bytes" * 8
        flow = play(
            [mysqlwire.MySQLWire()],
            LOGIN[:2]
            + [
                (False, pkt(2, b"\x01\x04")),
                (True, pkt(3, b"\x02")),
                (False, pkt(4, b"\x01-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n")),
                (True, pkt(5, secret)),
                (False, ok(6)),
            ],
        )
        self.assertEqual(
            flow.comment.split("\n")[2:],
            [
                "← LOGIN  full authentication asked",
                "→ LOGIN  public key asked",
                "← LOGIN  server public key sent",
                "→ LOGIN  auth data sent (not shown)",
                "← LOGIN  ok",
            ],
        )
        self.assertNotIn(secret, stored(flow))
        self.check_hidden(flow)

    def test_auth_switch_and_change_user(self):
        flow = play(
            [mysqlwire.MySQLWire()],
            LOGIN[:2]
            + [
                (False, pkt(2, b"\xfemysql_native_password\x00" + b"x" * 20 + b"\x00")),
                (True, pkt(3, AUTH_RESPONSE[:20])),
                (False, ok(4)),
                (True, pkt(0, b"\x11admin\x00" + bytes([20]) + AUTH_RESPONSE[:20] + b"shop\x00")),
                (False, ok(1)),
            ],
        )
        self.assertEqual(
            flow.comment.split("\n")[2:],
            [
                "← LOGIN  switch to mysql_native_password",
                "→ LOGIN  auth data sent (not shown)",
                "← LOGIN  ok",
                "→ CHANGE USER  user=admin  (credentials not shown)",
                "← LOGIN  ok",
            ],
        )
        self.assertNotIn(AUTH_RESPONSE[:20], stored(flow))


class TlsAndClaimTest(unittest.TestCase):
    def test_ssl_request_stops_decoding(self):
        ssl_request = pkt(1, struct.pack("<IIB", CLIENT_CAPS | 0x800, 0xFFFFFF, 45) + b"\x00" * 23)
        flow = play(
            [mysqlwire.MySQLWire()],
            [(False, greeting("8.4.3")), (True, ssl_request), (True, b"\x16\x03\x01\x00\xa5"), (False, b"\x16\x03\x03")],
        )
        self.assertEqual(
            flow.comment.split("\n")[1:],
            ["→ SSL request: TLS follows, the rest of this connection is encrypted and not decoded"],
        )

    def test_client_first_flows_are_left_alone(self):
        for chunks in ([(True, b"*1\r\n$4\r\nPING\r\n")], [(True, b"\x00\x00\x00\x08\x04\xd2\x16\x2f")]):
            flow = play([mysqlwire.MySQLWire()], chunks)
            self.assertEqual(flow.comment, "")
            self.assertNotIn("mysqlwire_messages", flow.metadata)

    def test_pgwire_leaves_mysql_and_redis_alone(self):
        for chunks in (SESSION, [(True, b"*1\r\n$4\r\nPING\r\n"), (False, b"+PONG\r\n")]):
            flow = play([pgwire.PgWire()], chunks)
            self.assertEqual(flow.comment, "")
            self.assertNotIn("pgwire_messages", flow.metadata)

    def test_pgwire_still_decodes_postgres_split_at_every_byte(self):
        startup = b"user\x00demo\x00database\x00shop\x00\x00"
        startup = struct.pack("!ii", 8 + len(startup), 196608) + startup
        query = b"Q" + struct.pack("!i", 4 + 9) + b"select 1\x00"
        flow = play([mysqlwire.MySQLWire(), rediswire.RedisWire(), pgwire.PgWire()], bytewise([(True, startup + query)]))
        self.assertEqual(flow.comment.split("\n"), ["→ CONNECT  user=demo database=shop", "→ SQL  select 1"])
        self.assertEqual(flow.metadata["wire_protocol"], "postgres")

    def test_unknown_protocol_is_left_raw_by_all(self):
        addons = [pgwire.PgWire(), rediswire.RedisWire(), mysqlwire.MySQLWire()]
        flow = play(addons, [(True, b"\x01\x02\x03\x04\x05\x06\x07\x08\x09"), (False, b"\xff\xfe")])
        self.assertEqual(flow.comment, "")
        self.assertNotIn("wire_protocol", flow.metadata)


if __name__ == "__main__":
    unittest.main()
