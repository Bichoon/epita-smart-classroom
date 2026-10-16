# EPITA Smart Classroom

Application web d’audit visuel des équipements d’une salle de cours, réalisée en HTML, CSS et JavaScript. Le moteur principal est **TensorFlow.js + COCO-SSD** ; un second moteur **Transformers.js + OWL-ViT** peut être chargé à la demande pour compléter les catégories difficiles.

## Fonctionnalités

- Parcours guidé en trois étapes : choisir une source, analyser, vérifier l’audit.
- Import JPG/PNG/WEBP et capture ponctuelle via webcam.
- Inférence dans le navigateur : aucune photo ou vidéo n’est envoyée par l’application pour être analysée ; seuls les poids des modèles sont téléchargés depuis leurs CDN/Hubs.
- Confirmation explicite d’un cadrage sans personne avant l’analyse ; les prédictions `person` ne sont jamais affichées ni utilisées.
- Détection avec cadres, catégories, scores de confiance et nombre d’objets par catégorie.
- Seuil réglable sans relancer l’inférence : les prédictions fusionnées sont conservées en mémoire et refiltrées à chaque changement du seuil.
- Trois modes d’analyse : **Rapide**, **Équilibré** et **Précis**.
- Mode de vision **Hybride — COCO + OWL-ViT** ou **COCO-SSD uniquement**.
- Audit réellement éditable : quantité attendue modifiable au clavier ou avec des boutons `− / +`, avec recalcul immédiat des écarts et KPI.
- Rapport d’audit imprimable ou exportable en PDF, avec contexte technique, limites et recommandations.

## Architecture de détection v3

### 1. COCO-SSD reste le moteur principal

COCO-SSD avec backbone `mobilenet_v2` est utilisé pour :

- `chair` → chaises ;
- `laptop` → ordinateurs portables ;
- `dining table` → signal partiel pour tables/bureaux ;
- `tv` → signal partiel pour écrans.

L’image complète est toujours analysée. Les recadrages supplémentaires sont désormais **adaptés aux catégories** :

- les grandes zones 2×2 restent utilisées pour les tables et écrans ;
- les grilles plus serrées 2×3 et 3×3 sont réservées aux chaises et laptops, afin d’éviter de découper inutilement les grands meubles.

### 2. Filtre anti-faux-positifs

La version précédente pouvait conserver des détections faibles et isolées, notamment sur les bords de l’image. La nouvelle chaîne applique maintenant :

- un seuil interne COCO plus raisonnable (`5 %` au lieu de `1 %`) ;
- une fusion multi-passes par IoU, recouvrement et proximité des centres ;
- un comptage des passes qui confirment un même objet ;
- des contrôles de taille et de rapport largeur/hauteur selon la catégorie ;
- un rejet renforcé des faibles détections isolées qui touchent un bord de l’image ;
- conservation d’une détection faible si elle est confirmée par plusieurs passes ou par plusieurs moteurs.

Ce filtre vise notamment à supprimer les rectangles parasites qui apparaissaient dans l’angle supérieur gauche alors qu’aucun objet n’y était présent.

### 3. Moteur complémentaire OWL-ViT

Le mode **Hybride** charge à la demande un pipeline de détection zero-shot OWL-ViT via Transformers.js. Il est utilisé pour rechercher explicitement :

- `classroom desk`, `school desk`, `classroom table`, `desk`, `table` ;
- `computer monitor`, `display screen`, `television screen` ;
- `whiteboard`, `classroom whiteboard` ;
- `window`, `classroom window`.

Les résultats COCO et OWL-ViT sont reprojetés dans le même repère, fusionnés lorsqu’ils décrivent le même objet, puis dédupliqués.

Les scores COCO et OWL-ViT n’ont pas la même calibration. Le curseur utilisateur est donc appliqué directement à COCO et transformé en seuil adapté pour OWL-ViT. L’interface affiche les scores bruts de chaque moteur afin de ne pas les confondre.

> Le premier chargement de OWL-ViT peut être nettement plus long et plus lourd que COCO-SSD. Si ce chargement échoue, l’application continue automatiquement avec COCO-SSD et l’audit marque les catégories dépendantes du moteur complémentaire comme non vérifiables automatiquement.

## Audit de configuration

Les quantités attendues sont stockées dans un véritable état JavaScript (`expectedCounts`) et non plus lues comme seule source de vérité depuis le DOM.

Chaque ligne propose :

- un bouton `−` ;
- un champ numérique ;
- un bouton `+`.

Toute modification met immédiatement à jour :

- quantité attendue ;
- quantité observée ;
- écart ;
- statut de vérification ;
- nombre de règles vérifiables ;
- nombre d’écarts.

Le champ n’est plus détruit/recréé pendant sa propre édition.

## Limites importantes

- COCO-SSD et OWL-ViT restent des modèles généralistes.
- Les sorties zero-shot pour tableau blanc et fenêtres sont **expérimentales** et doivent être confirmées visuellement.
- Une non-détection ne prouve pas l’absence d’un équipement.
- Le mode hybride améliore la couverture fonctionnelle, mais peut être plus lent et consommer davantage de mémoire.
- Pour un produit industriel, la meilleure étape suivante reste un modèle spécialisé/fine-tuné sur des images annotées de salles de cours.

## Lancer en local

Une connexion Internet est nécessaire lors du premier chargement des bibliothèques et des poids.

```bash
cd epita-smart-classroom
python -m http.server 8000
```

Ouvrir ensuite `http://localhost:8000`. La caméra nécessite `localhost` ou HTTPS et une autorisation du navigateur.

## Fichiers du dépôt

```text
index.html
style.css
app.js
README.md
DOSSIER_PROJET.md
TESTS.md
tests/static-check.mjs
test-classroom.jpg
baseline-detection.png
```

## Vérifications automatiques

```bash
node --check app.js
node tests/static-check.mjs
```

Ces vérifications sont statiques. Elles ne téléchargent pas les modèles et ne remplacent pas les tests navigateur.

## Tests navigateur avant remise

Voir `TESTS.md`. Les priorités sont :

1. vérifier la disparition des faux positifs faibles dans les zones vides ;
2. comparer COCO seul et mode Hybride sur la photo de salle ;
3. tester les quantités attendues avec `−`, saisie clavier et `+` ;
4. vérifier le repli COCO lorsque OWL-ViT est indisponible ;
5. comparer les modes Équilibré et Précis.

## Déploiement Cloudflare Pages

Pour un projet statique sans build :

- branche de production : `main` ;
- commande de build : vide, ou `exit 0` si nécessaire ;
- répertoire de sortie : `/` si les fichiers sont à la racine.

Après déploiement, vérifier l’URL publique, la caméra en HTTPS, les deux modes de vision, une analyse complète et l’export du rapport.

**URL publique :** à compléter après déploiement.
