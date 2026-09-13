#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Поиск в базе МККК «Prisoners of the First World War» (grandeguerre.icrc.org).

Сайт — одностраничное приложение, поэтому используется Playwright (Chromium).
  pip install playwright && python -m playwright install chromium
  python icrc_search.py --out ../../data/skiba/icrc      # перебирает Skiba, Skyba, Skibo, Shkiba, Schkiba, Skibba, Szkiba…

ВАЖНО: по данным самого МККК, картотеки по русскому фронту (русские пленные в
Германии и Австро-Венгрии) хранятся не в Женеве, а в архиве Датского Красного
Креста (Копенгаген, ныне Rigsarkivet). Поэтому отсутствие карточки на этом сайте
не означает, что её нет вообще. Скрипт сохраняет скриншоты и текст результатов;
селекторы формы могут потребовать правки — см. search_form.png.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import LATIN_SURNAMES  # noqa: E402

SEARCH_URL = "https://grandeguerre.icrc.org/en/File/Search/"


def run(surnames, out, headless=True):
    from playwright.sync_api import sync_playwright
    os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.goto(SEARCH_URL, wait_until="networkidle", timeout=120000)
        page.screenshot(path=os.path.join(out, "search_form.png"), full_page=True)
        for sn in surnames:
            page.goto(SEARCH_URL, wait_until="networkidle", timeout=120000)
            # 1) фамилия — первое текстовое поле формы
            inputs = page.locator("input[type='text'], input:not([type])")
            if inputs.count() == 0:
                print("Не нашёл текстовое поле — см. search_form.png", file=sys.stderr)
                break
            inputs.first.fill(sn)
            # 2) национальность / статус, если есть select-ы
            for sel in page.locator("select").all():
                opts = sel.locator("option").all_text_contents()
                for want in ("Russ", "Military", "Militaire"):
                    match = [o for o in opts if want.lower() in o.lower()]
                    if match:
                        try:
                            sel.select_option(label=match[0])
                        except Exception:  # noqa: BLE001
                            pass
            # 3) кнопка поиска
            btn = page.locator("button, input[type='submit']").filter(has_text=r"(?i)search|rechercher|find").first
            if btn.count():
                btn.click()
            else:
                inputs.first.press("Enter")
            page.wait_for_load_state("networkidle", timeout=120000)
            time.sleep(3)
            page.screenshot(path=os.path.join(out, f"results_{sn}.png"), full_page=True)
            text = page.locator("body").inner_text()
            with open(os.path.join(out, f"results_{sn}.txt"), "w", encoding="utf-8") as f:
                f.write(page.url + "\n\n" + text)
            links = [a.get_attribute("href") for a in page.locator("a[href*='/File/Details/'], a[href*='/List/']").all()]
            with open(os.path.join(out, f"links_{sn}.txt"), "w", encoding="utf-8") as f:
                f.write("\n".join(l for l in links if l))
            print(f"{sn}: {len(links)} ссылок на карточки/списки; url={page.url}")
        browser.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--surname", action="append", help="латинское написание; можно несколько раз")
    ap.add_argument("--out", default="out/icrc")
    ap.add_argument("--headed", action="store_true", help="показывать браузер")
    a = ap.parse_args()
    run(a.surname or LATIN_SURNAMES, a.out, headless=not a.headed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
