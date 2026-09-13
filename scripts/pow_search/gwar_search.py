#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Поиск на gwar.mil.ru («Памяти героев Великой войны 1914–1918», РГВИА/ЭЛАР).

Примеры:
  # все документы по «Скиба Савелий» (варианты имени перебираются автоматически)
  python gwar_search.py --last-name Скиба --out ../../data/skiba/gwar

  # только картотека военнопленных по фамилии, без фильтра по имени
  python gwar_search.py --last-name Скиба --no-first-name --types potery_voennoplen \
      --out ../../data/skiba/gwar_plen

У сайта нет публичного API — скрипт разбирает HTML. Имена GET-параметров
(last_name, first_name, middle_name, types, page) взяты из формы поиска
https://gwar.mil.ru/heroes/ ; если сайт их изменит, поправьте build_url().
При любой ошибке разбора сырой HTML сохраняется в <out>/raw/ для ручного просмотра.
"""
import argparse
import os
import re
import sys
import time
import urllib.parse

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FIRST_NAMES, SURNAMES, SURNAME_STEMS, get, name_matches, save_csv, save_json, session, slug, surname_matches  # noqa: E402

BASE = "https://gwar.mil.ru"
# Коды типов документов, как они передаются в параметре types (через двоеточие).
ALL_TYPES = ":".join([
    "awd_nagrady",                    # награды
    "awd_kartoteka",                  # картотека героев
    "potery_doc",                     # именные списки потерь
    "potery_gospital",                # картотека потерь (госпитальная)
    "potery_voennoplen",              # картотека военнопленных
    "potery_vozvrashhenie_iz_plena",  # возвращение из плена
    "potery_georgievskie_kavalery",   # георгиевские кавалеры
    "potery_spiski_zahoronenij",      # списки захоронений
    "potery_spiski_perezahoroneniya",
    "potery_iskluchenie_iz_spiskov",
    "potery_posluzhnoi_spisok",       # послужные списки
])


def build_url(last: str, first: str, middle: str, types: str, page: int) -> str:
    q = {
        "last_name": last,
        "first_name": first or "",
        "middle_name": middle or "",
        "groupby_anniversary": 1,
        "groupby_type": 1,
        "types": types,
        "page": page,
    }
    return BASE + "/heroes/?" + urllib.parse.urlencode(q)


def find_detail_links(html: str):
    soup = BeautifulSoup(html, "lxml")
    links = []
    for a in soup.select("a[href]"):
        href = a["href"]
        if re.search(r"/heroes/(chelovek_|commander)\w*\d+", href):
            full = urllib.parse.urljoin(BASE, href.split("#")[0])
            if full not in links:
                links.append(full)
    return links


def _pairs_from_text(text: str):
    out = {}
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"^([^:]{2,60}):\s*(.+)$", line)
        if m:
            out.setdefault(m.group(1).strip(), m.group(2).strip())
    return out


def parse_detail(html: str, url: str):
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    rec = {"url": url,
           "title": soup.title.get_text(" ", strip=True) if soup.title else ""}
    # dt/dd и th/td
    for dt in soup.select("dt"):
        dd = dt.find_next_sibling("dd")
        if dd:
            rec.setdefault(dt.get_text(" ", strip=True), dd.get_text(" ", strip=True))
    for th in soup.select("th"):
        td = th.find_next_sibling("td")
        if td:
            rec.setdefault(th.get_text(" ", strip=True), td.get_text(" ", strip=True))
    # «Метка: значение» построчно
    main = soup.select_one("main") or soup.body or soup
    text = main.get_text("\n", strip=True)
    for k, v in _pairs_from_text(text).items():
        rec.setdefault(k, v)
    # сканы
    imgs = []
    for tag in soup.select("img[src], a[href]"):
        src = tag.get("src") or tag.get("href")
        if src and re.search(r"\.(jpe?g|png|tiff?)(\?|$)|/img/|/images?/", src, re.I):
            full = urllib.parse.urljoin(BASE, src)
            if full not in imgs:
                imgs.append(full)
    rec["images"] = imgs
    rec["raw_text"] = text[:6000]
    return rec


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--last-name", default=None, help="фамилия (по умолчанию перебираются варианты из common.SURNAMES)")
    ap.add_argument("--first-name", default=None, help="имя (по умолчанию варианты из common.FIRST_NAMES)")
    ap.add_argument("--no-first-name", action="store_true", help="искать только по фамилии")
    ap.add_argument("--stems", action="store_true", help="дополнительно искать по основам Скиб/Скыб/Шкиб (если сайт ищет по началу фамилии)")
    ap.add_argument("--middle-name", default="")
    ap.add_argument("--types", default=ALL_TYPES)
    ap.add_argument("--max-pages", type=int, default=30)
    ap.add_argument("--download-images", action="store_true")
    ap.add_argument("--out", default="out/gwar")
    ap.add_argument("--delay", type=float, default=1.5, help="пауза между запросами, сек")
    a = ap.parse_args()

    os.makedirs(os.path.join(a.out, "raw"), exist_ok=True)
    s = session()
    surnames = [a.last_name] if a.last_name else list(SURNAMES)
    if a.stems:
        surnames += [st for st in SURNAME_STEMS if st not in surnames]
    firsts = [""] if a.no_first_name else ([a.first_name] if a.first_name else FIRST_NAMES)

    detail_urls = []
    for ln in surnames:
        for fn in firsts:
            for page in range(1, a.max_pages + 1):
                url = build_url(ln, fn, a.middle_name, a.types, page)
                r = get(s, url)
                fname = os.path.join(a.out, "raw", slug(f"search_{ln}_{fn}_{page}") + ".html")
                with open(fname, "w", encoding="utf-8") as f:
                    f.write(r.text)
                links = find_detail_links(r.text)
                new = [u for u in links if u not in detail_urls]
                print(f"[{ln} {fn}] page {page}: {len(links)} links, {len(new)} new", file=sys.stderr)
                detail_urls.extend(new)
                if not new:
                    break
                time.sleep(a.delay)

    records = []
    for i, url in enumerate(detail_urls, 1):
        r = get(s, url)
        rec = parse_detail(r.text, url)
        rec["matches_target_name"] = name_matches(rec["title"])
        rec["matches_surname"] = surname_matches(rec["title"])
        records.append(rec)
        with open(os.path.join(a.out, "raw", slug(url.split("/heroes/")[-1]) + ".html"), "w", encoding="utf-8") as f:
            f.write(r.text)
        print(f"{i}/{len(detail_urls)} {rec['title']}", file=sys.stderr)
        if a.download_images:
            for j, img in enumerate(rec["images"]):
                try:
                    ir = get(s, img)
                    ext = os.path.splitext(urllib.parse.urlparse(img).path)[1] or ".jpg"
                    p = os.path.join(a.out, "img", slug(url.split("/heroes/")[-1]) + f"_{j}{ext}")
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "wb") as f:
                        f.write(ir.content)
                except Exception as e:  # noqa: BLE001
                    print(f"  image failed {img}: {e}", file=sys.stderr)
        time.sleep(a.delay)

    save_json(os.path.join(a.out, "results.json"), records)
    flat = [{k: (", ".join(v) if isinstance(v, list) else v) for k, v in r.items() if k != "raw_text"} for r in records]
    save_csv(os.path.join(a.out, "results.csv"), flat)
    hits = [r for r in records if r["matches_target_name"]]
    print(f"\nВсего записей: {len(records)}; с похожей фамилией: {sum(r['matches_surname'] for r in records)}; похожих на искомое ФИО: {len(hits)}")
    for r in hits:
        print(" *", r["title"], r["url"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
