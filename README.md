# Računi — slikaj in obreži

Spletna aplikacija (brez strežnika): uporabnik slika račun iz trgovine, aplikacija
sama najde bel list na fotografiji, ga izreže, poravna perspektivo in shrani kot **JPG**
v galerijo na strani. Vse teče v brskalniku — fotografije ne gredo nikamor v splet.

## Zagon

```bash
node serve.js          # ali: npm start
```

V konzoli se izpišeta naslova. `http://localhost:8080` odpri na računalniku,
naslov oblike `http://192.168.x.x:8080` pa **na telefonu** (isto WiFi omrežje) —
tam deluje gumb »Slikaj račun«, ki odpre kamero.

> Prek naslova IP se aplikacija ne da **namestiti** in ne deluje brez povezave:
> Chrome oboje omogoči le na `https://` ali `localhost`. Glej *Namestitev kot aplikacija*.

> Odpiranje `index.html` z dvoklikom (`file://`) odsvetujem: brskalniki v tem načinu
> omejijo IndexedDB, zato se računi ne shranijo.

## Uporaba

1. **📷 Slikaj račun** — račun položi na **temno podlago** (miza, tla) in ga slikaj od zgoraj.
2. Aplikacija označi bel list z zelenim okvirjem. Če je zgrešila, **povleci vogale**.
   Gumb **↻ Zavrti** obrne sliko za 90°, **⟲ Ponovna zaznava** pa požene zaznavo znova.
3. **✓ Obreži in shrani** — izrezan račun se shrani v galerijo.
4. Klik na sličico odpre pregled: **Prenesi JPG**, **Deli** (na telefonu) ali **Izbriši**.

Možnost *Posvetli / poravnaj barve* razpotegne kontrast in odstrani rumen odtenek
umetne svetlobe, da je papir res bel in besedilo berljivo.

## Kako deluje zaznava

`js/detect.js`, brez zunanjih knjižnic:

1. **Pomanjšava** na 420 px širine — besedilo se zlije v sivino, ostane oblika lista.
2. **Maska papirja**: prag svetlosti po Otsujevi metodi + zavrnitev nasičenih barv
   (les, tkanina so barvni, papir ni).
3. **Največja povezana komponenta** + **zapolnitev lukenj** (temne vrstice besedila
   sicer razsekajo list na kose).
4. **Konveksna ovojnica** → med njenimi točkami se poišče **štirikotnik z največjo ploščino**
   (to prenese tudi perspektivo, ne le rotacije).
5. **Preverjanje verodostojnosti**: rob lista se mora po svetlosti razlikovati od podlage
   in izrez ne sme pokriti skoraj cele slike. Če ne, aplikacija to pove in ponudi ročno nastavitev.
6. **Izrez**: homografija štirikotnik → pravokotnik z bilinearnim vzorčenjem, torej se
   popravi tudi poševen kot fotografiranja. Izhod največ 1500 px po daljši stranici, JPG kakovosti 0,92.

**Omejitev:** bel račun na beli/svetli podlagi ni ločljiv od ozadja — takrat aplikacija
pošteno javi, da ni prepričana, in vogale nastaviš ročno. Zato slikaj na temni podlagi.

## Testi

```bash
npm test          # vsi trije testi (66 preverb, brez zunanjih odvisnosti)
```

**`test/detect.node.test.js` — zaznava (9/9).** Sintetizira fotografije z znanimi vogali
(raven, zavrten, perspektiva, senca, majhen račun, ležeč račun, bela podlaga, prazna slika,
izrojeni vogali) in preveri, da je napaka vogalov pod 3 % diagonale in da je izrez svetel.

**`test/app.node.test.js` — vmesnik (34/34).** Posnema DOM, kamero, IndexedDB in Blob ter
požene pravi `js/app.js` skozi celoten potek: zajem → zaznava → vlečenje vogala → obrez →
shranjevanje → galerija → pregled → prenos → izbris, vključno s preklicem, vrtenjem, tem da
se poziv za namestitev ne prestreza, in trdo osvežitvijo (odjava service workerja, brisanje
predpomnilnikov, ponovno nalaganje).

**`test/pwa.node.test.js` — namestljivost (23/23).** Preveri pogoje, ki jih Chrome zahteva
za namestitev: polja v manifestu, obstoj ikon in ujemanje njihovih **dejanskih** velikosti
(iz glave PNG) z navedenimi, povezavo na manifest, registracijo service workerja in to,
da so vse predpomnjene datoteke res v repozitoriju.

`test/test.html` požene zaznavo v brskalniku in poleg številk pokaže tudi slike.

## Struktura

| Datoteka | Vloga |
|---|---|
| `index.html`, `style.css` | vmesnik (temna tema, prilagojen telefonu) |
| `js/detect.js` | zaznava lista in perspektivni izrez |
| `js/db.js` | shramba v IndexedDB |
| `js/app.js` | povezava vmesnika, galerija, prenos/deljenje |
| `sw.js`, `manifest.json`, `icon.svg`, `icons/` | PWA — namestitev v Chrome, delovanje brez povezave |
| `tools/make-icons.js` | zgenerira ikone PNG iz risbe (brez odvisnosti) |
| `serve.js` | lokalni strežnik za razvoj in preizkus |

## Namestitev kot aplikacija

Aplikacija je PWA, zato jo Chrome namesti kot pravo namizno/telefonsko aplikacijo:
svoja ikona, svoje okno brez naslovne vrstice, deluje tudi brez povezave.

Aplikacija nima lastnega gumba za namestitev — Chrome jo ponudi sam, brž ko ugotovi,
da je namestitev mogoča: ikona v naslovni vrstici oz. meni ⋮ → *Namesti Računi*.

**Chrome ponudi namestitev samo na varnem izvoru** (`https://` ali `localhost`).
To je edini pogoj, ki ga ni v tem repozitoriju:

| Kje odpreš | Namestitev |
|---|---|
| `http://localhost:8080` (`npm start`) | ✅ deluje |
| `https://...` (npr. GitHub Pages) | ✅ deluje |
| `http://192.168.x.x:8080` prek WiFi | ❌ ni varen izvor — glej spodaj |
| `file://index.html` | ❌ ne deluje (tudi shramba ne) |

### Na telefon

Telefon do domačega računalnika dostopa prek naslova IP, ta pa ni varen izvor —
zato Chrome tam namestitve **ne** ponudi. Dve poti, ki delujeta:

**1. Objava na GitHub Pages (priporočeno)** — dobiš stalen naslov `https://`, ki ga
odpreš na katerem koli telefonu:

```bash
git add . && git commit -m "PWA: namestitev v Chrome"
git push
```

Nato v repozitoriju na GitHubu: *Settings → Pages → Source: Deploy from a branch →
`main` / `(root)`*. Čez minuto je stran na `https://zig4to.github.io/Racuni/`.
Odpri jo v Chromu na telefonu → meni ⋮ → *Namesti aplikacijo*.

> Vse poti v aplikaciji so relativne, zato deluje tudi v podmapi, kakršno da GitHub Pages.

**2. Preizkus prek kabla USB** — brez objave, za razvoj: telefon priklopi z USB
(vklopljeno *USB debugging*), na računalniku odpri `chrome://inspect/#devices` →
*Port forwarding* → `8080` → `localhost:8080`. Na telefonu odpri `http://localhost:8080` —
to velja za varen izvor in namestitev deluje.

Na iPhonu namestitve ne ponuja Chrome, ampak **Safari** → *Deli* → *Dodaj na začetni zaslon*.

### Ikone

`icons/*.png` so zgenerirane iz iste risbe kot `icon.svg` (Chrome za namestitev zahteva
rastrski ikoni 192 in 512 px). Ob spremembi risbe:

```bash
npm run icons
```

## Kje so shranjeni računi

V brskalniku (IndexedDB) na napravi, kjer si jih slikal — niso v oblaku in niso vidni
na drugih napravah. Brisanje podatkov strani v brskalniku jih izbriše, zato pomembne
račune prenesi z gumbom **Prenesi JPG**.
