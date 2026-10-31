/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
/*!
 * ★ LOCAL MODIFICATION NOTICE — Octave-Full-Wasm fork (2026-10-31)
 * Upstream: coi-serviceworker v0.1.7 (MIT). This file is a **modified** copy.
 * Modification: the `message` event handler now rejects messages whose origin is not the
 * service worker's own origin (see the `_sameOrigin` guard below). Rationale: GitRoll
 * flagged "Verify the origin of the received message" (CWE/HTML5). Upstream accepted
 * arbitrary messages, so any page holding a reference to this worker could (1) deregister
 * it, or (2) flip COEP from `require-corp` to `credentialless` — weakening the
 * cross-origin isolation this whole project depends on.
 * MIT permits modification provided the copyright notice above is retained (it is).
 */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    // ★ 本仓 fork 修补（2026-10-31，GitRoll issue #7 的 VULNERABILITY「Verify the origin of
    //   the received message」）：上游 v0.1.7 的 message handler **不校验来源** ⇒ 任何拿到本
    //   SW 引用的页面都能发消息：① `deregister` 注销正在工作的 SW（服务拒绝）②
    //   `coepCredentialless` 把 COEP 从 require-corp 翻成 credentialless（**降低隔离强度**）。
    //   后果不是"读取机密"，而是"让本该隔离的站点不再隔离" —— 本仓纯客户端计算的底座
    //   正是这个隔离。⇒ 只接受**同源**消息。
    //
    //   判据（SW 语境里没有 `ev.origin`，要自己比）：`ev.source` 是同源 WindowClient 才算。
    //   若 `ev.source` 拿不到（极端情况）⇒ 用 `ev.origin` 兜底比对 `self.location.origin`。
    const _sameOrigin = (ev) => {
        const want = self.location.origin;
        if (ev.origin && ev.origin !== "null" && ev.origin !== want) return false;
        if (ev.origin === "null") return false;          // opaque origin ⇒ 拒
        const src = ev.source;
        if (src && src.url) {
            try { return new URL(src.url).origin === want; } catch (e) { return false; }
        }
        return !!ev.origin && ev.origin === want;        // 只剩 origin 可比时
    };

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (!_sameOrigin(ev)) {
            // 不说话地拒（日志一条便于排查，但不回声给可能的攻击者）
            console.warn("[coi-sw] 拒绝非同源消息（origin=" + String(ev.origin) + "）");
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                    }
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });

} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = (reloadedBySelf == "coepdegrade");

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(
                coepDegrading || window.crossOriginIsolated
            );
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: (reloadToDegrade || coepHasFailed && coi.coepDegrade())
                    ? false
                    : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });

                // If the registration is active, but it's not controlling the page
                if (registration.active && !n.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
    })();
}
