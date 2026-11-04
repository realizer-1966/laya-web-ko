#!/usr/bin/env python3
"""Headless-Chromium smoke test for the Korean multilingual site.

    pip install playwright && python -m playwright install --with-deps chromium
    node scripts/prepare_site.mjs --model-dir build-multilingual/model --out dist-test
    SMOKE_DIST=dist-test python tests/browser_smoke_ml.py

The original tests/browser_smoke.py compares against saved *English* PyTorch outputs, so it cannot
be used with the multilingual checkpoint. This test instead proves the end-to-end path works:
service worker makes the page cross-origin isolated, the multilingual ONNX build loads on WASM,
one real inference runs, and the scores are finite and in range.
"""
import functools, http.server, json, os, socketserver, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / os.environ.get("SMOKE_DIST", "dist")
VARIANT = os.environ.get("SMOKE_VARIANT", "q8e8")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript",
                      ".js": "text/javascript", ".wasm": "application/wasm",
                      ".onnx": "application/octet-stream", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    if not DIST.exists():
        sys.exit(f"{DIST} missing; run scripts/prepare_site.mjs first")
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(DIST)))
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        pg = b.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"[:300]))
        pg.on("pageerror", lambda e: logs.append("[pageerror] " + str(e)[:300]))
        pg.goto(f"http://127.0.0.1:{port}/index.html")

        for _ in range(30):  # service worker registers, then the page reloads once
            time.sleep(1)
            try:
                if pg.evaluate("self.crossOriginIsolated"):
                    break
            except Exception:
                pass
        isolated = pg.evaluate("self.crossOriginIsolated")
        print("cross-origin isolated via service worker:", isolated)
        assert isolated, "service worker did not make the page cross-origin isolated"

        # 모델 manifest 가 있으므로 빌드 드롭다운이 실제 변형으로 채워져야 한다.
        pg.wait_for_function(
            "document.querySelectorAll('#variant option').length > 0 && !document.querySelector('#variant').disabled",
            timeout=60000)
        options = pg.eval_on_selector_all("#variant option", "els => els.map(e => e.value)")
        print("variants offered:", options)
        assert VARIANT in options, f"{VARIANT} not offered: {options}"

        pg.select_option("#variant", VARIANT)
        pg.select_option("#backend", "wasm")
        pg.click("#loadBtn")

        st = ""
        for _ in range(900):  # first run downloads ~350 MB and initialises the session
            time.sleep(1)
            st = pg.inner_text("#status")
            if st.startswith("준비 완료") or st.startswith("모델을 로드할 수 없습니다"):
                break
        print("status:", st)
        assert st.startswith("준비 완료"), st

        pg.click("#runBtn")
        pg.wait_for_function("window.__laya && window.__laya.ready && document.querySelector('#resultCard').style.display !== 'none'",
                             timeout=180000)
        summary = pg.evaluate("""() => [...document.querySelectorAll('#answers .q')]
            .map(c => c.innerText.replace(/\\s+/g, ' ').slice(0, 140))""")
        print("answers:", json.dumps(summary, ensure_ascii=False))
        assert summary, "no answers rendered"

        raw = json.loads(pg.inner_text("#raw"))
        for qid, a in raw["answers"].items():
            if a["type"] in ("choice", "score"):
                total = sum(a["probabilities"].values())
                assert abs(total - 1) < 0.02, (qid, total)
                assert 0 <= a["confidence"] <= 1, (qid, a["confidence"])
            if a["type"] == "choice":
                assert a["choice"] in a["probabilities"], (qid, a["choice"])
            elif a["type"] == "score":
                assert 0 <= a["score"] <= len(a["legend"]) - 1, (qid, a["score"], len(a["legend"]))
            else:
                assert 0 <= a["noul"] <= 1, (qid, a["noul"])
        print("raw answers valid:", list(raw["answers"]))

        errs = [l for l in logs if l.startswith("[pageerror]")]
        assert not errs, errs
        b.close()
    print("browser smoke test passed")


if __name__ == "__main__":
    main()
