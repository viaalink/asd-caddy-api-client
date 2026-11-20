"""
Load the addons in mitmproxy-addons/ for unit tests, with or without mitmproxy.

When mitmproxy is not installed (CI's unit-test job, most laptops), a stub of
the two modules the addons import (contentviews, tcp) stands in: the decoders
and the addon hooks only need a TCPFlow class and a content view registry.
The integration tests (just test-layer4) run the same files in real mitmweb.
"""
from __future__ import annotations

import importlib.util
import sys

sys.dont_write_bytecode = True  # never leave __pycache__ in mitmproxy-addons/ (it ships)
import types
from pathlib import Path

ADDONS = Path(__file__).resolve().parents[2] / "mitmproxy-addons"

try:
    from mitmproxy import tcp as _tcp  # noqa: F401

    REAL_MITMPROXY = True
except ImportError:
    REAL_MITMPROXY = False
    mitmproxy = types.ModuleType("mitmproxy")
    contentviews = types.ModuleType("mitmproxy.contentviews")
    tcp = types.ModuleType("mitmproxy.tcp")

    class View:
        name = "stub"

    class TCPFlow:
        pass

    contentviews.View = View
    contentviews.add = lambda view: None
    contentviews.remove = lambda view: None
    contentviews.format_text = lambda text: iter([[("text", text)]])
    tcp.TCPFlow = TCPFlow
    mitmproxy.contentviews = contentviews
    mitmproxy.tcp = tcp
    sys.modules.update({"mitmproxy": mitmproxy, "mitmproxy.contentviews": contentviews, "mitmproxy.tcp": tcp})

from mitmproxy import tcp  # noqa: E402


def load_addon(name: str):
    spec = importlib.util.spec_from_file_location(f"addon_{name}", ADDONS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Message:
    def __init__(self, from_client: bool, content: bytes) -> None:
        self.from_client = from_client
        self.content = content


class Flow(tcp.TCPFlow):
    """Just what the addons use of a TCPFlow."""

    _n = 0

    def __init__(self) -> None:  # noqa: D107 (the real one wants connections)
        Flow._n += 1
        self.id = f"flow-{Flow._n:04d}-0000"
        self.messages: list[Message] = []
        self.metadata: dict = {}
        self.comment = ""


def play(addons, chunks: list[tuple[bool, bytes]], end: bool = True) -> Flow:
    """Send the chunks through every addon, as mitmproxy would; (True, …) is client → server."""
    flow = Flow()
    for from_client, data in chunks:
        flow.messages.append(Message(from_client, data))
        for addon in addons:
            addon.tcp_message(flow)
    if end:
        for addon in addons:
            addon.tcp_end(flow)
    return flow


def bytewise(chunks: list[tuple[bool, bytes]]) -> list[tuple[bool, bytes]]:
    """Every byte its own TCP message: the worst split there is."""
    return [(c, data[i : i + 1]) for c, data in chunks for i in range(len(data))]
