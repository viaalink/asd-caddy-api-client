/**
 * The films of this repo, for Viaalink's film engine (private, not part of
 * this repository). Only what is specific to these films lives here: the
 * storyboards, the code-server and Caddy setup, the demo helpers.
 *
 * Want to know how the films are made? Mail info@viaalink.com.
 */
import { resolve } from "path";

export default {
  /** Code cards cut files from the repository root. */
  root: resolve(__dirname, "../.."),
  out: resolve(__dirname, "../local/video"),
  boards: {
    "caddy-tools": {
      storyboard: resolve(__dirname, "storyboard.ts"),
      setup: resolve(__dirname, "global-setup.ts"),
      teardown: resolve(__dirname, "global-teardown.ts"),
    },
    "caddy-mitm": {
      storyboard: resolve(__dirname, "storyboard-mitm.ts"),
    },
    "caddy-sql": {
      storyboard: resolve(__dirname, "storyboard-sql.ts"),
    },
  },
};
