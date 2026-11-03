#!/usr/bin/env python3
"""Build a webOS .ipk from an app source folder, in the same layout ares-package produces.

Usage: build_ipk.py <src_dir> <out_dir>
"""
import io, json, os, struct, sys, tarfile, time, gzip

def ar_member(name, data, mtime):
    # Classic GNU ar header (60 bytes), names <= 15 chars, so no long-name table needed.
    header = (f"{name:<16}{int(mtime):<12}0     0     100644  {len(data):<10}`\n").encode("ascii")
    assert len(header) == 60, len(header)
    body = data + (b"\n" if len(data) % 2 else b"")
    return header + body

def make_tar_gz(entries, mtime):
    """entries: list of (archive_path, bytes). Directories are added implicitly."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tf:
        dirs_done = set()
        for path, data in entries:
            parts = path.split("/")[:-1]
            for i in range(1, len(parts) + 1):
                d = "/".join(parts[:i])
                if d in dirs_done:
                    continue
                dirs_done.add(d)
                ti = tarfile.TarInfo(d + "/")
                ti.type = tarfile.DIRTYPE; ti.mode = 0o755; ti.mtime = mtime
                ti.uname = ti.gname = "root"
                tf.addfile(ti)
            ti = tarfile.TarInfo(path)
            ti.size = len(data); ti.mode = 0o644; ti.mtime = mtime
            ti.uname = ti.gname = "root"
            tf.addfile(ti, io.BytesIO(data))
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", mtime=mtime) as gz:
        gz.write(raw.getvalue())
    return out.getvalue()

def main(src, out_dir):
    with open(os.path.join(src, "appinfo.json"), encoding="utf-8") as f:
        app = json.load(f)
    app_id, version, vendor, title = app["id"], app["version"], app.get("vendor", "N/A"), app.get("title", app["id"])
    mtime = int(time.time())

    data_entries = []
    total = 0
    for root, _, files in os.walk(src):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, src).replace(os.sep, "/")
            with open(p, "rb") as f:
                b = f.read()
            total += len(b)
            data_entries.append((f"usr/palm/applications/{app_id}/{rel}", b))
    packageinfo = {
        "app": app_id, "id": app_id, "loc_name": title,
        "package_format_version": 2, "vendor": vendor, "version": version,
    }
    data_entries.append((f"usr/palm/packages/{app_id}/packageinfo.json",
                         (json.dumps(packageinfo, indent=2) + "\n").encode("utf-8")))

    control = (
        f"Package: {app_id}\nVersion: {version}\nSection: misc\nPriority: optional\n"
        f"Architecture: all\nInstalled-Size: {max(1, total // 1024)}\nMaintainer: {vendor} <nobody@example.com>\n"
        f"Description: This is a webOS application.\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: 3.0.0\n"
    ).encode("utf-8")

    ipk = b"!<arch>\n"
    ipk += ar_member("debian-binary", b"2.0\n", mtime)
    ipk += ar_member("control.tar.gz", make_tar_gz([("control", control)], mtime), mtime)
    ipk += ar_member("data.tar.gz", make_tar_gz(data_entries, mtime), mtime)

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{app_id}_{version}_all.ipk")
    with open(out, "wb") as f:
        f.write(ipk)
    print(out, len(ipk), "bytes")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
