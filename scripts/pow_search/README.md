# Скрипты поиска военнопленного ПМВ по открытым базам

Цель: найти записи о **Скибе Савелии Прокловиче, 1890 г. р.**, в германском плену 1914–1919.
Перебираемые варианты написания заданы в `common.py`: фамилия Скиба/Скыба/Скибо/Шкиба/Скеба, латиницей
Skiba/Skyba/Skibo/Shkiba/Schkiba/Skibba/Szkiba; имя Савелий/Савва/Сава/Савка (Sawelij/Saweli/Savelij/Sawa);
отчество Проклович/Проклов, а также писарские «исправления» Прокопьевич/Прокофьевич.
Подробный разбор источников — в `research/skiba_savely_prokopovich_pow_wwi.md`.

> Внимание: из облачной сессии Claude Code эти сайты недоступны (сетевая политика, 403 от прокси),
> поэтому скрипты **не тестировались на живых сайтах**. Запускайте их на своём компьютере.
> Если разметка сайта изменилась, скрипты сохраняют сырой HTML/скриншоты для ручного разбора.

## Установка

```bash
cd scripts/pow_search
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium      # только для icrc_search.py
sudo apt install poppler-utils             # pdftotext, только для svrt_search.py --pdf
```

## Запуск

```bash
# 1. gwar.mil.ru — все документы, перебор вариантов фамилии/имени, скачать сканы
python gwar_search.py --stems --out ../../data/skiba/gwar --download-images

# 1a. только картотека военнопленных, по фамилии без имени
python gwar_search.py --last-name Скиба --no-first-name --types potery_voennoplen --out ../../data/skiba/gwar_plen --download-images

# 2. СВРТ: сайт + PDF-списки за букву «С» по губерниям
python svrt_search.py --pdf --gubernii akmol,akmol2,kiev,volinsk,bessar,ekatrinosl,poltav,chernig,harkov,herson,podol,tavr --out ../../data/skiba/svrt

# 3. МККК (Женева) — Skiba / Skyba, Russian, Military
python icrc_search.py --out ../../data/skiba/icrc
```

Результаты: `results.json` / `results.csv` в указанных каталогах, сырые страницы в `raw/`, сканы в `img/`.

## Что смотреть в найденных записях

Полк, губерния/уезд, дата события, лагерь, архивная ссылка (фонд/опись/дело/лист). Полк и лагерь открывают
дальнейший поиск в РГВИА (ф. 16196, ф. 12651), в Rigsarkivet (картотека Датского Красного Креста по русским
пленным) и в земельном архиве той германской земли, где стоял лагерь.
