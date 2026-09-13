# -*- coding: utf-8 -*-
"""Общие вспомогательные функции для скриптов поиска военнопленных ПМВ."""
import csv
import json
import os
import re
import time
from typing import Dict, Iterable, List

import requests

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Варианты написания. Фамилию в плену записывали немецкие писари латиницей на слух,
# а в Петрограде переводили обратно в кириллицу, поэтому в картотеках встречаются
# искажения. Отчество — Проклович (от имени Прокл); писари часто «исправляли» его
# на привычные Прокопьевич/Прокофьевич.
SURNAMES = ["Скиба", "Скыба", "Скибо", "Шкиба", "Скеба", "Скибба", "Скыбо", "Шкыба"]
SURNAME_STEMS = ["Скиб", "Скыб", "Шкиб", "Скеб"]
FIRST_NAMES = ["Савелий", "Саввелий", "Савва", "Сава", "Савка", "Савелей", "Савел", "Савелiй"]
PATRONYMICS = ["Проклович", "Проклов", "Прокловичъ",
               "Прокопьевич", "Прокофьевич", "Прокопович", "Прокопьев", "Прокофьев"]
LATIN_SURNAMES = ["Skiba", "Skyba", "Skibo", "Shkiba", "Schkiba", "Skibba", "Szkiba", "Skieba", "Skuba"]
LATIN_FIRST_NAMES = ["Sawelij", "Saweli", "Savelij", "Savely", "Sawelj", "Saveli", "Sawa", "Sawka", "Sawwa"]
LATIN_PATRONYMICS = ["Proklowitsch", "Proklovich", "Proklow", "Proklov"]

# Регулярные выражения для «мягкого» сравнения найденных записей с искомым ФИО.
SURNAME_RE = r"(?:ш|с)к[иыеіi]б|скуб|s(?:ch|h)?k[iy]e?b|szkib"
FIRST_NAME_RE = r"сав[вa]?[еэ]л|савв?а\b|савк|saw[ea]l|savel|sawk?a\b"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})
    return s


def get(s: requests.Session, url: str, retries: int = 4, **kw) -> requests.Response:
    """GET с повторами и паузой, чтобы не нагружать сайт."""
    delay = 2.0
    last = None
    for _ in range(retries):
        try:
            r = s.get(url, timeout=60, **kw)
            if r.status_code < 500:
                return r
            last = RuntimeError(f"HTTP {r.status_code} for {url}")
        except requests.RequestException as e:  # noqa: PERF203
            last = e
        time.sleep(delay)
        delay *= 2
    raise RuntimeError(f"failed: {url}: {last}")


def name_matches(text: str) -> bool:
    """Строка похожа на «Скиба Савелий …» с учётом искажений (Скыба, Шкиба, Skyba…)."""
    t = text.lower()
    return bool(re.search(SURNAME_RE, t)) and bool(re.search(FIRST_NAME_RE, t))


def surname_matches(text: str) -> bool:
    """Только фамилия похожа на Скиба (для карточек без имени)."""
    return bool(re.search(SURNAME_RE, text.lower()))


def save_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def save_csv(path: str, rows: Iterable[Dict[str, str]]) -> None:
    rows = list(rows)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    keys: List[str] = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def slug(text: str) -> str:
    return re.sub(r"[^\w.-]+", "_", text, flags=re.U).strip("_")[:120]
