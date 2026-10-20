# Third-party notices

## dsh-acl-sandbox-patch

`vendor/acl-sandbox-patch/preload.cjs` and `src/acl-patch.js` are derived from
[dsh-acl-sandbox-patch](https://github.com/masknull/dsh-acl-sandbox-patch),
which provides a temporary, ACL-free workaround for the DSH Windows sandbox
failing to grant write access on non-system-drive workspaces:

- Upstream project: https://github.com/masknull/dsh-acl-sandbox-patch
- Vendored version: 0.1.2
- License: MIT

The vendored preload is copied verbatim; `src/acl-patch.js` is the host entry
adapted to this package's layout and entry name. The workaround changes no
system ACL and no file ownership: it wraps only the sandbox's own FFI calls in
memory.

MIT License

Copyright (c) 2026 dsh-acl-sandbox-patch contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
