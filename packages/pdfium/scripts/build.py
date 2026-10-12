#!/usr/bin/env python3
"""Reproducible local PDFium + C++ bridge build (Linux x64/arm64)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from patch_source import patch

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = json.loads((ROOT / "native/versions.json").read_text())


def run(args, cwd=None, env=None):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def checkout(url, revision, target):
    if not (target / ".git").exists():
        target.mkdir(parents=True, exist_ok=True)
        run(["git", "init", target])
        run(["git", "remote", "add", "origin", url], cwd=target)
        run(["git", "fetch", "--depth", "1", "origin", revision], cwd=target)
        run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=target)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=target, text=True).strip()
    resolved = subprocess.run(["git", "rev-parse", "--verify", revision + "^{commit}"], cwd=target, text=True, capture_output=True)
    if resolved.returncode:
        # A shallow fetch of a tag can create only FETCH_HEAD, not a local tag.
        # Resolve the requested remote revision again rather than trusting an
        # unrelated FETCH_HEAD in a reused checkout.
        run(["git", "fetch", "--depth", "1", "origin", revision], cwd=target)
        expected = subprocess.check_output(["git", "rev-parse", "FETCH_HEAD^{commit}"], cwd=target, text=True).strip()
    else:
        expected = resolved.stdout.strip()
    if actual != expected:
        raise RuntimeError(f"Refusing to modify mismatched checkout {target}: {actual}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache")
    parser.add_argument("--source", type=Path, help="Existing pinned PDFium checkout with dependencies")
    parser.add_argument("--emsdk", type=Path, help="Existing Emscripten SDK at pinned version")
    parser.add_argument("--build-tools", type=Path, help="Existing pinned pdfium-binaries checkout")
    parser.add_argument("--gn", type=Path, help="GN executable")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    build_tools = args.build_tools or cache / "build-tools"
    checkout("https://github.com/bblanchon/pdfium-binaries.git", VERSIONS["buildTools"], build_tools)
    emsdk = args.emsdk or cache / "emsdk"
    if not args.emsdk:
        checkout("https://github.com/emscripten-core/emsdk.git", VERSIONS["emscripten"], emsdk)
        run([emsdk / "emsdk", "install", VERSIONS["emscripten"]])
        run([emsdk / "emsdk", "activate", VERSIONS["emscripten"]])
    source = args.source
    gn = args.gn
    if not source:
        depot = cache / "depot_tools"
        checkout("https://chromium.googlesource.com/chromium/tools/depot_tools.git", VERSIONS["depotTools"], depot)
        work = cache / "checkout"
        work.mkdir(exist_ok=True)
        env = {**os.environ, "DEPOT_TOOLS_UPDATE": "0"}
        config = {"name": "pdfium", "url": "https://pdfium.googlesource.com/pdfium.git", "managed": False,
                  "custom_vars": {"checkout_configuration": "minimal"}}
        (work / ".gclient").write_text(f"solutions = [{config!r}]\n")
        run([depot / "gclient", "sync", "--revision", VERSIONS["pdfium"], "--shallow", "--no-history", "--nohooks",
             "--ignore-dep-type", "cipd", "--ignore-dep-type", "gcs", "-j", str(args.jobs)], cwd=work, env=env)
        source = work / "pdfium"
        arch = "arm64" if platform.machine() in ("aarch64", "arm64") else "amd64"
        run([depot / "cipd", "install", f"gn/gn/linux-{arch}", VERSIONS["gn"], "-root", cache / "gn"])
        gn = cache / "gn/gn"
    source = source.resolve()
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if actual != VERSIONS["pdfium"]:
        raise RuntimeError(f"PDFium revision mismatch: {actual}")
    for name, target in [("pdfium.patch", source), ("build.patch", source / "build")]:
        filename = build_tools / "patches/wasm" / name
        if subprocess.run(["git", "apply", "--reverse", "--check", filename], cwd=target, capture_output=True).returncode:
            run(["git", "apply", filename], cwd=target)
    config = source / "build/config/wasm"
    config.mkdir(exist_ok=True)
    shutil.copyfile(build_tools / "patches/wasm/config.gn", config / "BUILD.gn")
    patch(source)
    out = source / "out/legir-wasm"
    out.mkdir(parents=True, exist_ok=True)
    (out / "args.gn").write_text(f'''is_debug = false
is_component_build = false
pdf_is_standalone = false
pdf_is_complete_lib = true
pdf_use_partition_alloc = false
pdf_use_skia = false
pdf_enable_v8 = false
pdf_enable_xfa = false
pdf_enable_fontations = false
target_cpu = "wasm"
target_os = "emscripten"
is_clang = false
use_custom_libcxx = false
use_sysroot = false
use_remoteexec = false
use_siso = false
treat_warnings_as_errors = false
symbol_level = 0
emscripten_path = "{emsdk.resolve()}/upstream/emscripten"
''')
    em = emsdk.resolve() / "upstream/emscripten"
    actual_version = (em / "emscripten-version.txt").read_text().strip().strip('"')
    if actual_version != VERSIONS["emscripten"]:
        raise RuntimeError(f"Emscripten revision mismatch: {actual_version}")
    env = {**os.environ, "PATH": str(em) + os.pathsep + os.environ["PATH"]}
    run([gn or source / "buildtools/linux64/gn", "gen", out, "--script-executable=" + sys.executable], cwd=source, env=env)
    run(["ninja", "-C", out, "-j", args.jobs, "pdfium"], env=env)
    dest = ROOT / "wasm"
    dest.mkdir(exist_ok=True)
    native = ROOT / "native/bridge.cpp"
    exported = sorted(set("_" + name for name in re.findall(r"\b(LPDF_\w+)\s*\(", native.read_text())))
    # Public entry points used by typed bindings, including text geometry.
    exported += ["_malloc", "_free", "_FPDFText_LoadPage", "_FPDFText_ClosePage", "_FPDFText_CountChars",
                 "_FPDFText_GetUnicode", "_FPDFText_GetFontSize", "_FPDFText_GetFontInfo", "_FPDFText_GetCharBox",
                 "_FPDFText_GetCharOrigin", "_FPDFText_GetCharAngle", "_FPDFText_GetFillColor"]
    run([em / "em++", native, ROOT / "native/text_edit.cpp", ROOT / "native/image_cache.cpp", out / "obj/libpdfium.a", "-I" + str(source), "-I" + str(out / "gen"),
         "-std=c++20", "-fno-rtti", "-fno-exceptions", "-msimd128", "-O2", "-DNDEBUG", "-DPDF_USE_AGG",
         "--no-entry", "-sSTACK_SIZE=1048576", "-sALLOW_MEMORY_GROWTH=1", "-sMAXIMUM_MEMORY=2147483648", "-sMODULARIZE=1", "-sEXPORT_ES6=1",
         "-sENVIRONMENT=web,worker,node", "-sEXPORTED_FUNCTIONS=" + json.dumps(exported),
         "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["HEAPU8", "HEAPU32", "HEAPF32", "HEAPF64"]),
         "-o", dest / "pdfium.js"], env=env)
    # Upstream's license collector includes PDFium and the linked libraries.
    license_env = {**env, "PDFium_SOURCE_DIR": str(source), "PDFium_BUILD_DIR": str(out), "PDFium_ENABLE_V8": "false"}
    run(["bash", build_tools / "steps/08-licenses.sh"], cwd=build_tools, env=license_env)
    shutil.copytree(build_tools / "staging/licenses", dest / "licenses", dirs_exist_ok=True)
    shutil.copyfile(build_tools / "LICENSE", dest / "licenses/build-tools.txt")
    shutil.copyfile(source / "third_party/libyuv/LICENSE", dest / "licenses/libyuv.txt")
    shutil.copyfile(em / "LICENSE", dest / "licenses/emscripten.txt")
    for name, filename in [("musl", "system/lib/libc/musl/COPYRIGHT"), ("libcxx", "system/lib/libcxx/LICENSE.TXT"), ("libcxxabi", "system/lib/libcxxabi/LICENSE.TXT"), ("compiler-rt", "system/lib/compiler-rt/LICENSE.TXT")]:
        shutil.copyfile(em / filename, dest / f"licenses/{name}.txt")
    manifest = {**VERSIONS, "features": {"v8": False, "xfa": False, "threads": False, "renderer": "agg"},
                "sha256": {name: hashlib.sha256((dest / name).read_bytes()).hexdigest() for name in ["pdfium.js", "pdfium.wasm"]},
                "sourceSha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in sorted((ROOT / "native").glob("*")) if path.is_file()},
                "patchSha256": hashlib.sha256((ROOT / "scripts/patch_source.py").read_bytes()).hexdigest(),
                "buildScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (dest / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
