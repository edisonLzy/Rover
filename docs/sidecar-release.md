# Runtime sidecar builds

Rover ships `@rover/runtime` as a Node single executable application (SEA).
The installed Tauri app launches the bundled `rover-runtime` through the Rust
shell plugin. It never searches for Node.js on the user's machine.

## Development

Install the exact Node version in `.node-version`, then run `pnpm install
--frozen-lockfile` and `pnpm dev`. The development command builds the same SEA
that is packaged for production before starting Tauri. Restart `pnpm dev` after
changing runtime source code; Vite only reloads the frontend automatically.

## Native packages

Run `pnpm package:mac:arm64`, `pnpm package:mac:x64`, or `pnpm package:win` on a
machine whose `rustc --print host-tuple` matches the requested target. The SEA
builder rejects mismatched targets rather than relabeling a host executable.
Each package command builds the SEA first, then asks Tauri to include it through
`bundle.externalBin`.

The CI workflow in `.github/workflows/release.yml` builds each platform on a
native runner. It starts both the generated SEA and the staged packaged binary
with Node removed from `PATH`, then checks the runtime health endpoint. Tagged
builds create a draft GitHub release after every platform build succeeds.

macOS distribution outside local testing requires signing and notarization of
the final app with release credentials. CI artifacts without those credentials
are suitable for build verification, but macOS Gatekeeper may reject them.
