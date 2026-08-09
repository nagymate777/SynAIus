# ADR-0006: Engedélykötött, sandboxolt webpanel

- Állapot: elfogadva, első kör megvalósítva
- Dátum: 2026-08-09

## Döntés

A teljes külső weboldalak első megjelenítési módja önálló `web-panel` tartalommodul. A modul közvetlen böngészős iframe-et használ; nem továbbítja és nem tölti le a céloldalt a helyi bridge-en keresztül. Ezzel az első változat nem nyit szerveroldali kérés-hamisítási (SSRF) felületet a helyi gép és a belső hálózat felé.

A tartalompéldány a cél URL-jét és az engedélyezett eredetek soronkénti listáját tárolja. Csak hitelesítő adat nélküli `http` és `https` URL fogadható el. Az engedélylista elemei kizárólag teljes eredetek lehetnek útvonal, lekérdezés és töredék nélkül. A cél eredetének pontosan szerepelnie kell ezen a listán; aldomain, protokoll és port nem öröklődik. A SynAIus saját eredete nem ágyazható vissza.

Az origin-szabály mellett minden doboz külön `web.external.embed` jogosultságot igényel. A renderer csak a jogosultság és az origin-szabály teljesülése után hozza létre az iframe-et. A klónozott doboz a tartalmi hivatkozást átveszi, de a hálózati jogosultságot nem örökli.

## Sandbox-profil

Az első interaktív profil az oldal működéséhez engedélyezi az űrlapokat, a JavaScriptet és az eredeti origint, de nem engedélyez felső szintű navigációt, felugró ablakot, letöltést vagy eszközhozzáférést. A referrer továbbítása tiltott. A saját origin visszabeágyazásának tiltása azért kötelező, mert a `allow-scripts` és `allow-same-origin` kombináció azonos eredetű tartalomnál feloldhatná a kívánt elkülönítést.

## Beágyazást tiltó céloldalak

A céloldal `X-Frame-Options` vagy CSP `frame-ancestors` szabálya megtilthatja a megjelenítést. Ennek eredményét a böngésző a szülőoldalnak nem jelzi minden esetben megbízhatóan. A panel ezért mindig megmutatja az engedélyezett origint, külön lapos megnyitási lehetőséget és egy állandó, lokalizált magyarázatot az üres vagy hibás kerethez. Nem állítunk elő bizonytalan automatikus siker- vagy hibajelzést.

## Következmények

- A webpanel használhat meglévő böngészős webhelymunkamenetet, de csak a felhasználó által felsorolt pontos originhez és a doboz engedélyezése után.
- A domainlista megváltoztatásakor a nem engedélyezett iframe azonnal megszűnik.
- Oldalrész-kivonás, hitelesített szerveroldali proxy és belső hálózati szolgáltatásfelderítés nem része ennek a modulnak.
- Ha később szerveroldali letöltés szükséges, külön gateway, rendszergazdai origin-szabály, DNS-újraellenőrzés, IP-tartomány-védelem, átirányítási korlát és válaszméret-korlát szükséges.
