# ADR-0005: Provideralapú artifact-megjelenítés

- Állapot: elfogadva, első kör megvalósítva
- Dátum: 2026-08-09

## Döntés

A fájl- és artifact-megjelenítő önálló SynAIus-modul. A doboz konfigurációja nem tartalmaz fájltartalmat, csak a provider nevét és a providerhez szükséges stabil hivatkozást. Az első provider a `thread-file`, amely egy Codex-feladat azonosítójával és egy, a feladat munkamappájához viszonyított fájlútvonallal dolgozik.

A böngésző közvetlenül nem fér hozzá a helyi fájlrendszerhez. A bridge a friss `thread/read` snapshot munkamappájából indul ki, kanonizálja a gyökeret és a célfájlt, majd csak akkor olvas, ha a cél a gyökéren belül marad. Ha a Codex a thread indítási mappáján kívül dolgozott egy később megadott munkamappában, kizárólag az ugyanazon thread hiteles `fileChange` itemjében pontosan felsorolt abszolút fájl kap egyszeri olvasási jogosultságot; a szomszédos fájlok nem. A könyvtárkilépés, a symlinkkel történő kiszökés, a nem reguláris fájl, a méretkorlát túllépése, az ismeretlen bináris formátum és a tipikus titokfájlok elérése hibával leáll.

Az első változat UTF-8 szöveget, biztonságosan React-elemekké bontott Markdown-alapformázást és engedélyezett raszterképeket jelenít meg. HTML-t vagy SVG-t nem futtat, és nem használ nyers HTML-befecskendezést. A megjelenítő providerfüggetlen `ArtifactGateway` szerződést kap, ezért később feltöltött, távoli node-ról származó vagy más integrációból érkező artifactokkal is használható.

## Munkaterület-integráció

A fájlaktivitás megnyitása egyetlen `content.box.create` domainparanccsal hozza létre a tartalompéldányt, a dobozt és a köztük lévő kapcsolatot. Így a művelet atomi, egy lépésben visszavonható, és ugyanaz a verziózott parancsréteg használható a felhasználói felületről, MCP-ből vagy későbbi automatizációból.

## Fájlindex és nézetek

A thread fájlböngészője nem járja be önállóan a munkamappa fájlrendszerét. Az index kizárólag az App Server `fileChange` itemjeiben közölt fájlokat tartalmazza, útvonalanként a legutóbbi változással és a változások számával. Az index és az egyedi fájlolvasás ugyanazt az `ArtifactGateway` szerződést használja.

Az artifact-doboz az aktuális fájltartalom és a legutóbbi diff között válthat. A diff akkor is megjeleníthető, ha a fájlt időközben törölték. Ugyanazon thread és fájl ismételt megnyitása nem hoz létre újabb tartalompéldányt: a munkaterület aktiválja a megfelelő nézetet, középre igazítja és röviden kiemeli a már létező dobozt.

## Következmények

- A munkaterület mentése csak artifact-hivatkozást tartalmaz, helyi fájltartalmat nem másol a böngészőtárba.
- A fájl frissíthető ugyanabban a dobozban, de törölt vagy már nem engedélyezett fájlnál jól meghatározott hiba jelenik meg.
- A provider nem jogosít általános fájlböngészésre; csak a kiválasztott Codex-feladat munkamappáján belüli, támogatott fájl olvasható.
- Távoli node-ok előtt az artifact-providernek külön node-hitelesítést és jogosultságellenőrzést kell kapnia.
