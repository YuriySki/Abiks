#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Поиск в базе СВРТ «Первая мировая война, 1914–1918. Алфавитные списки потерь
нижних чинов» (1914.svrt.ru) и в PDF-списках по губерниям (svrt.ru/1914/).

Примеры:
  python svrt_search.py --surname Скиба --out ../../data/skiba/svrt
  python svrt_search.py --surname Скиба --pdf --gubernii akmol,kiev,volinsk,poltav --out ../../data/skiba/svrt

Для PDF нужен pdftotext (пакет poppler-utils).
"""
import argparse
import os
import re
import subprocess
import sys
import time
import urllib.parse

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FIRST_NAMES, SURNAMES, get, save_csv, session  # noqa: E402

INDEX = "https://1914.svrt.ru/index.php"
EXT = "https://1914.svrt.ru/extsearch.php"
PDF_BASE = "https://svrt.ru/1914/{code}/1914-{code}-{letter}.pdf"

# Коды каталогов на svrt.ru/1914/ (проверены только те, что встречались в
# поисковой выдаче: kiev, volinsk, bessar, ekatrinosl, simbir, akmol). Остальные —
# предположение; при 404 скрипт просто пропускает губернию и печатает ссылку
# на индекс https://svrt.ru/1914/ , где можно уточнить код вручную.
GUBERNII_DEFAULT = ["akmol", "kiev", "volinsk", "bessar", "ekatrinosl", "poltav",
                    "chernig", "harkov", "herson", "podol", "tavr", "kursk", "voronej"]


def parse_tables(html: str):
    soup = BeautifulSoup(html, "lxml")
    rows = []
    for table in soup.select("table"):
        headers = [th.get_text(" ", strip=True) for th in table.select("tr th")]
        for tr in table.select("tr"):
            tds = [td.get_text(" ", strip=True) for td in tr.select("td")]
            if not tds:
                continue
            if headers and len(headers) == len(tds):
                row = dict(zip(headers, tds))
            else:
                row = {f"col{i}": v for i, v in enumerate(tds)}
            link = tr.select_one("a[href]")
            if link:
                row["link"] = urllib.parse.urljoin(INDEX, link["href"])
            rows.append(row)
    return rows


def search_site(s, surname: str, out_rows: list, delay: float):
    for base, extra in ((INDEX, {}), (EXT, {"name_ext": 1, "surname_ext": 1})):
        for pg in range(1, 40):
            q = {"surname": surname, **extra}
            if pg > 1:
                q["pg"] = pg
            url = base + "?" + urllib.parse.urlencode(q)
            r = get(s, url)
            rows = parse_tables(r.text)
            rows = [dict(r_, source_url=url) for r_ in rows]
            print(f"{url}: {len(rows)} строк", file=sys.stderr)
            if not rows:
                break
            out_rows.extend(rows)
            if "pg=" not in r.text and pg == 1 and len(rows) < 50:
                break
            time.sleep(delay)


def grep_pdfs(s, codes, out_dir: str, delay: float):
    hits = []
    os.makedirs(out_dir, exist_ok=True)
    for code in codes:
        url = PDF_BASE.format(code=code, letter="s")
        r = get(s, url)
        if r.status_code != 200 or not r.content.startswith(b"%PDF"):
            print(f"нет PDF: {url} (HTTP {r.status_code}); проверьте код каталога на https://svrt.ru/1914/", file=sys.stderr)
            continue
        pdf = os.path.join(out_dir, f"1914-{code}-s.pdf")
        with open(pdf, "wb") as f:
            f.write(r.content)
        txt = pdf[:-4] + ".txt"
        subprocess.run(["pdftotext", "-layout", pdf, txt], check=False)
        if not os.path.exists(txt):
            print("pdftotext не найден — установите poppler-utils", file=sys.stderr)
            continue
        with open(txt, encoding="utf-8", errors="replace") as f:
            for n, line in enumerate(f, 1):
                if re.search(r"ск[иы]б", line, re.I):
                    hits.append({"guberniya": code, "line_no": n, "line": line.rstrip(), "pdf": url})
        time.sleep(delay)
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--surname", action="append", help="фамилия; можно несколько раз (по умолчанию варианты из common)")
    ap.add_argument("--pdf", action="store_true", help="также скачать PDF за букву С по губерниям и найти строки Скиба/Скыба")
    ap.add_argument("--gubernii", default=",".join(GUBERNII_DEFAULT))
    ap.add_argument("--out", default="out/svrt")
    ap.add_argument("--delay", type=float, default=1.5)
    a = ap.parse_args()

    s = session()
    rows = []
    for sn in (a.surname or SURNAMES):
        search_site(s, sn, rows, a.delay)
    save_csv(os.path.join(a.out, "all_rows.csv"), rows)
    target = [r for r in rows if any(fn.lower() in " ".join(r.values()).lower() for fn in FIRST_NAMES)]
    save_csv(os.path.join(a.out, "results.csv"), target)
    print(f"Строк всего: {len(rows)}; с именем Савелий/Савва/Сава: {len(target)}")
    for r in target:
        print(" *", " | ".join(v for k, v in r.items() if k not in ("link", "source_url")))

    if a.pdf:
        hits = grep_pdfs(s, [c.strip() for c in a.gubernii.split(",") if c.strip()], os.path.join(a.out, "pdf"), a.delay)
        save_csv(os.path.join(a.out, "pdf_hits.csv"), hits)
        print(f"Строк Скиба/Скыба в PDF: {len(hits)}")
        for h in hits:
            print(f" [{h['guberniya']}:{h['line_no']}] {h['line']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
