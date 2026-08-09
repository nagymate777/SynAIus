# ADR-0007: Tartós munkaterület-vezérlés

- Állapot: elfogadva, első kör megvalósítva
- Dátum: 2026-08-09

## Döntés

A böngésző helyi tárolója helyett a Workspace Control szolgáltatás a munkaterület
hiteles, tartós tulajdonosa. A böngésző, a későbbi MCP-k és más vezérlők ugyanazokat
a verziózott `WorkspaceCommand` parancsokat küldik, és minden módosítás a közös
domain-parancsmagon halad át.

A szolgáltatás SQLite-adatbázisban, egy tranzakcióban rögzíti az új munkaterület-
állapotot és a hozzá tartozó tartós eseményt. Az esemény csak sikeres commit után
juthat el az előfizetőkhöz. A parancsazonosító munkaterületenként egyedi, ezért egy
újraküldött azonos parancs idempotens; eltérő tartalmú azonosító ütközésnek számít.
Az `expectedRevision` védi az állapotot az elvesző, egymást felülíró módosításoktól.

## Kapcsolat és helyreállítás

A kezdeti állapot és a parancsok JSON HTTP-végpontokon közlekednek. Az élő változások
SSE-csatornán érkeznek. Minden esemény tartós kurzort kap, így megszakadás után a
kliens vissza tudja játszani a hiányzó eseményeket. Revíziórés vagy hibás esemény
esetén a böngésző teljes, hiteles szerverpillanatképet kér, és abból áll helyre.

A felület a szerver visszaigazolása előtt optimisztikusan megjelenítheti a saját
parancsát, de kapcsolatfelépítés és helyreállítás alatt nem enged új szerkesztést.
A `localStorage` megmarad gyors helyi induló példánynak és visszafelé kompatibilis
mentésnek, de csatlakoztatott üzemmódban nem hiteles állapotforrás.

## Biztonsági és telepítési határ

Az adatbázis a figyelmen kívül hagyott `data/` könyvtárban marad, nem kerül GitHubra.
A HTTP-szolgáltatás alapértelmezetten csak a helyi bridge része; a Vite és a Tailscale
útvonal ugyanahhoz a bridge-hez továbbít. A későbbi MCP-adapter nem kap külön
állapotkezelést: kizárólag a Workspace Control olvasási és parancsvégpontjait használja.

## Következmények

- Több böngésző és később több MCP-kliens ugyanazt a munkaterületet látja.
- A szerver újraindítása nem veszíti el az állapotot vagy az eseménytörténetet.
- A domain-validáció, a revízióütközés és az idempotencia minden vezérlőre egységes.
- Több gépes szinkron, hitelesítés, jogosultsági házirend és távoli replikáció külön
  fejlesztési kör feladata.
