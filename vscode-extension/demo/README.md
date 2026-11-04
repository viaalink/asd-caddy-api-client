# Demo films

The storyboards behind the films of the VS Code extension and the MITM demo:

- [Caddy Configuration Tools for VS Code](https://youtu.be/IIfOw6wbDMQ): `storyboard.ts`
  (code-server and Caddy are started by `global-setup.ts`).
- [Inspect live traffic with Caddy and mitmproxy](https://youtu.be/Jt4BY9unm9k):
  `storyboard-mitm.ts` (against the repo-root `demo/`, started with `just demo start`).

Every step in a storyboard does what a user would do and checks that it worked, so a
broken demo fails the recording instead of ending up on film.

The films are made with Viaalink's own film and voice tooling, which is not part of
this repository; `just demo-video` and `just vscode-demo-video` only work on a machine
that has it. Curious how we make them? Mail **info@viaalink.com**.
