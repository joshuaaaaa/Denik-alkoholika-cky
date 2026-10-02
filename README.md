# Můj deník 📔

Mobilní aplikace (PWA) – osobní deník pro každého, kdo něco prožil. Pro všední i nevšední dny,
pocity, plány a milníky života a volitelně i pro cestu ke střízlivosti.
Inspirováno knihami Michaely Duffkové *Zápisník alkoholičky* a *Deník nealkoholičky*.

Vzhled: linkovaný papír s okrajem, ručně psané písmo a kniha, ve které se listuje stránkami.

## Funkce

| Oblast | Co umí |
|---|---|
| ✍️ Zápisky | denní i **hodinové** zápisy, všední / ⭐ nevšední den, nadpis, štítky, nálada, pocity, vděčnost |
| 🎙️ Diktování | převod hlasu na text v češtině, hlasové příkazy („tečka“, „čárka“, „nový řádek“…), **korektura** se zvýrazněním změn, vlastní slovník oprav, oprava i po uložení, historie verzí, uchování původního přepisu |
| 📷 Fotky | automatické zmenšení a převod do WebP (typicky z 3–5 MB na ~200 kB), volba kvality |
| 🎥 Vlogy | natáčení videa přímo v aplikaci v 480p s nízkým datovým tokem, hlasové poznámky, náhled ve knize |
| 📅 Kalendář | měsíční přehled s barvou nálady, hodinová časová osa dne (klepnutím na hodinu nový zápis) |
| 📖 Kniha | listování stránkami s animací otáčení, výběr období, kapitola milníků, **export do PDF** (A5), sdílení, tisk |
| ⭐ Milníky | časová osa důležitých událostí života podle oblastí (rodina, práce, zdraví, střízlivost…) s fotkou |
| 🎯 Plány a sny | cíle rozdělené na kroky, průběh, termín do kalendáře (.ics), splněný cíl → milník |
| 🌱 Střízlivost (volitelné) | počítadlo dní, ušetřené peníze, milníky, záznam bažení, „nový začátek“ bez odsuzování |
| 🆘 SOS | dýchání do čtverce, 15minutové „surfování na vlně bažení“, HALT, vlastní důvody a dopis sobě, krizové linky (116 123, 800 350 000, 155, 112) a vlastní kontakty |
| 📊 Statistiky | graf nálady za 30 dní, nejčastější pocity, série psaní, odznaky |
| 🔒 Soukromí | vše jen v zařízení (IndexedDB), zámek PINem, záloha/obnova do souboru, export textu (Markdown) |
| Další | inspirace k psaní na každý den, „Tento den v minulosti“, hledání bez diakritiky, denní připomínka do kalendáře telefonu, tmavý režim, offline režim |

## Spuštění

Aplikace je čistě statická (HTML + JS moduly), bez sestavování.

```bash
npx http-server -c-1 .     # nebo: python3 -m http.server
# otevřít http://localhost:8080
```

Pro instalaci do telefonu je potřeba HTTPS – stačí nahrát složku např. na GitHub Pages / Netlify.
Pak v Chrome (Android) „Přidat na plochu“, v Safari (iPhone) Sdílet → „Přidat na plochu“.

## Struktura

```
index.html            kostra aplikace
css/style.css         vzhled (linkovaný papír, kniha, tmavý režim)
js/app.js             spuštění, navigace, zámek
js/views.js           obrazovky
js/editor.js          editor zápisu, nahrávání, korektura, milníky, plány
js/book.js            stránkování knihy, listování, PDF
js/text.js            hlasové příkazy, autokorektura, porovnání textů, inspirace
js/media.js           komprese fotek, nahrávání videa/zvuku, rozpoznávání řeči
js/db.js              úložiště IndexedDB
sw.js                 offline režim
vendor/               jsPDF a html2canvas (MIT) pro export PDF
```

## Poznámky

- Diktování používá Web Speech API – funguje v Chrome/Edge a Safari. V Chrome může zvuk zpracovávat Google.
- Data jsou jen v prohlížeči telefonu – pravidelně dělejte **zálohu** (Více → Záloha).
- Nativní APK/IPA lze z aplikace vytvořit např. přes Capacitor nebo PWABuilder.
