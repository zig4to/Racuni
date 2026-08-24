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

## Test

```bash
node test/detect.node.test.js      # ali: npm test
```

Test sintetizira fotografije z znanimi vogali (raven, zavrten, perspektiva, senca,
majhen račun, ležeč račun, bela podlaga, prazna slika, izrojeni vogali) in preveri,
da je napaka vogalov pod 3 % diagonale ter da je izrez svetel. Trenutno **9/9**.
Datoteka `test/test.html` požene isto v brskalniku in pokaže slike.

## Struktura

| Datoteka | Vloga |
|---|---|
| `index.html`, `style.css` | vmesnik (temna tema, prilagojen telefonu) |
| `js/detect.js` | zaznava lista in perspektivni izrez |
| `js/db.js` | shramba v IndexedDB |
| `js/app.js` | povezava vmesnika, galerija, prenos/deljenje |
| `sw.js`, `manifest.json`, `icon.svg` | PWA — namestitev na telefon, delovanje brez povezave |
| `serve.js` | lokalni strežnik za razvoj in preizkus |

## Namestitev na telefon

Odpri stran v Chromu na telefonu → meni → *Dodaj na začetni zaslon*. Aplikacija se
zažene čez cel zaslon in deluje tudi brez povezave.

## Objava na splet (GitHub Pages)

```bash
git init && git add . && git commit -m "Racuni"
git branch -M main
git remote add origin git@github.com:<uporabnik>/racuni.git
git push -u origin main
```

Nato v repozitoriju: *Settings → Pages → Deploy from branch → main / (root)*.
Stran je čez minuto na `https://<uporabnik>.github.io/racuni/`.

## Kje so shranjeni računi

V brskalniku (IndexedDB) na napravi, kjer si jih slikal — niso v oblaku in niso vidni
na drugih napravah. Brisanje podatkov strani v brskalniku jih izbriše, zato pomembne
račune prenesi z gumbom **Prenesi JPG**.
