# EPITA Smart Classroom — mini-dossier de gestion de projet

## 1. Cadrage

### Problématique métier
Un responsable de salle doit vérifier visuellement que le mobilier et les équipements sont présents en quantité suffisante. Un contrôle manuel peut prendre du temps et être difficile à standardiser. L’application propose une aide au contrôle fondée sur les objets effectivement détectés par un modèle pré-entraîné.

### Objectifs
- Fournir une interface compréhensible par un responsable non technique.
- Analyser une image fixe de la salle et afficher uniquement des catégories, cadres et scores réellement produits par le modèle.
- Améliorer le rappel sur les objets petits/éloignés grâce à une analyse multi-passes, sans inventer de détections.
- Comparer les quantités attendues aux quantités détectées pour les classes raisonnablement exploitables.
- Rendre visibles les limites du modèle et les écarts à contrôler.
- Générer un compte rendu imprimable ou exportable en PDF.
- Exécuter l’inférence dans le navigateur sans enregistrer ni transmettre les images.

### Utilisateurs cibles
- Responsable de salle ou personnel de support pédagogique.
- Équipe projet chargée de tester et de démontrer le prototype.

### Périmètre du MVP
- Page d’accueil et parcours en trois étapes.
- Import d’image et capture ponctuelle via webcam.
- Confirmation du cadrage excluant toute personne avant analyse.
- Détection COCO-SSD avec cadres, classes, scores et seuil réglable.
- Trois modes de calcul : Rapide, Équilibré et Précis.
- Analyse multi-passes par recadrages chevauchants et agrandissement contrôlé.
- Fusion/dédoublonnage des prédictions issues de plusieurs passes.
- Tableau de bord calculé à partir des résultats réels.
- Quantités attendues modifiables, écarts et statut de vérification.
- Rapport d’audit comprenant contexte technique, résultats, limites et recommandations.
- Documentation et protocole de tests.

### Fonctionnalités exclues
- Reconnaissance, identification ou analyse biométrique des personnes.
- Enregistrement des photos ou vidéos, historique nominatif ou envoi applicatif vers un serveur.
- Entraînement d’un modèle depuis zéro dans le cadre du MVP.
- Promesse de détecter toutes les tables de cours, tous les tableaux ou toutes les fenêtres.
- Décision automatique concluant qu’un équipement est absent à partir d’une seule non-détection.
- API backend ou Cloudflare Workers, non nécessaires pour le MVP.

## 2. Architecture

- **Frontend :** HTML, CSS et JavaScript natifs.
- **Vision principale :** TensorFlow.js et COCO-SSD chargés depuis jsDelivr, backbone `mobilenet_v2`.
- **Vision complémentaire :** Transformers.js + OWL-ViT, chargé à la demande en mode hybride pour les catégories difficiles. Si ce moteur échoue, le système conserve les résultats COCO et marque les catégories dépendantes comme non vérifiables automatiquement.
- **Traitement :** inférence côté navigateur ; les prédictions `person` sont exclues des résultats, compteurs, audit et rapport. Le parcours exige une confirmation manuelle d’un cadrage sans personne avant analyse. Les sorties des deux moteurs sont reprojetées dans le même repère puis fusionnées/dédupliquées par catégorie fonctionnelle.
- **Données :** état temporaire en mémoire ; aucune persistance applicative des images.
- **Hébergement visé :** GitHub pour le code et Cloudflare Pages pour l’application statique.

### Pipeline de détection amélioré

1. **Passe globale COCO-SSD** sur l’image entière.
2. **Découpage adapté à la catégorie** : les tables/écrans utilisent surtout des zones larges 2×2 ; les chaises/laptops utilisent aussi des grilles 2×3 et, en mode Précis, 3×3.
3. **Agrandissement contrôlé des tuiles** avant inférence pour donner davantage de pixels aux petits objets.
4. **Seuil interne relevé** et **filtre qualité** combinant score, nombre de passes, taille, proportions et position sur les bords. Les faibles faux positifs isolés au bord sont rejetés sauf confirmation.
5. **Passe zero-shot OWL-ViT à la demande** sur les catégories difficiles : bureaux/tables, moniteurs, tableaux blancs et fenêtres. En mode Précis, des demi-images supplémentaires peuvent être analysées.
6. **Reprojection** de toutes les bounding boxes dans les coordonnées de l’image d’origine.
7. **Fusion/dédoublonnage multi-moteurs** à partir de l’IoU, du recouvrement sur la plus petite boîte et de la proximité des centres.
8. **Conservation des prédictions fusionnées brutes** : le curseur peut monter puis redescendre sans relancer l’inférence. Les scores COCO et OWL-ViT restent affichés séparément car ils ne sont pas calibrés de la même manière.

### Classes et limites
- `chair` : COCO-SSD, avec confirmation multi-vues pour limiter les faux positifs faibles.
- `laptop` : COCO-SSD, avec passes zoomées adaptées aux petits objets.
- `dining table` : signal COCO partiel pour tables/bureaux, complété en mode hybride par `classroom desk`, `school desk`, `classroom table`, `desk`, `table`.
- `tv` : signal COCO partiel, complété par `computer monitor`, `display screen`, `television screen`.
- Tableau blanc : recherche zero-shot expérimentale via `whiteboard` / `classroom whiteboard`.
- Fenêtres : recherche zero-shot expérimentale via `window` / `classroom window`.

Si le moteur complémentaire est indisponible, le système revient à COCO-SSD et les catégories uniquement couvertes par OWL-ViT repassent en vérification manuelle.

Une non-détection peut résulter d’un objet masqué, mal cadré, flou, trop éloigné ou d’une classe non prise en charge. Elle ne prouve pas l’absence de l’objet.


## 2 bis. Améliorations techniques prioritaires v3

1. **Audit éditable fiable :** les quantités attendues sont stockées dans `expectedCounts`. Les champs ne servent plus de base de données implicite et ne sont pas recréés pendant leur propre édition.
2. **Réduction des faux positifs :** seuil interne COCO relevé, confirmation multi-vues, contrôle de géométrie et rejet renforcé des faibles détections isolées au bord de l’image.
3. **Passes adaptées à la catégorie :** les grands objets (tables/écrans) utilisent l’image entière et des zones larges ; les petites catégories (chaises/laptops) bénéficient de grilles plus fines.
4. **Détection hybride :** OWL-ViT complète COCO-SSD lorsque les catégories sélectionnées le nécessitent. Les scores restent affichés séparément car leur calibration diffère.

## 3. Backlog et planification

| ID | Tâche / user story | Priorité | Statut |
|---|---|---|---|
| US-01 | Importer une image autorisée de la salle | Haute | Implémenté |
| US-02 | Démarrer et arrêter la caméra | Haute | Implémenté, validation navigateur finale à faire |
| US-03 | Capturer une image fixe et la conserver visible avant analyse | Haute | Implémenté, validation navigateur finale à faire |
| US-04 | Régler le seuil de confiance | Haute | Implémenté ; correction du refiltrage bidirectionnel intégrée |
| US-05 | Afficher cadres, classes, scores et quantités | Haute | Implémenté |
| US-06 | Choisir Rapide / Équilibré / Précis | Haute | Implémenté |
| US-07 | Améliorer la détection par recadrages multi-passes | Haute | Implémenté |
| US-08 | Dédoublonner les prédictions des différentes passes | Haute | Implémenté |
| US-09 | Modifier les quantités attendues | Haute | Implémenté avec état `expectedCounts`, saisie clavier et boutons − / + |
| US-10 | Consulter les écarts et le statut global | Haute | Implémenté |
| US-11 | Générer un rapport d’audit imprimable | Haute | Implémenté |
| US-12 | Afficher clairement classes partielles/non vérifiables | Haute | Implémenté, y compris repli si OWL-ViT est indisponible |
| US-13 | Gérer les erreurs caméra et modèle | Haute | Implémenté, tests navigateur à exécuter |
| US-14 | Déployer sur Cloudflare Pages | Haute | À faire sur le compte du projet |
| US-15 | Exécuter et consigner le protocole de tests | Haute | Fichier `TESTS.md` prêt ; mesures manuelles à réaliser |
| US-16 | Mesurer précision/rappel sur au moins 3 images annotées | Moyenne | À exécuter avant annonce chiffrée |
| US-17 | Réduire les faux positifs isolés de bord | Haute | Filtre qualité implémenté, validation visuelle à faire |
| US-18 | Compléter COCO avec un détecteur zero-shot ciblé | Haute | OWL-ViT intégré en chargement à la demande, validation navigateur à faire |

## 4. KPI

1. **Rappel de détection** = TP / (TP + FN), utile pour vérifier si les objets visibles sont effectivement retrouvés.
2. **Précision de détection** = TP / (TP + FP), utile pour contrôler les faux positifs introduits par une analyse plus agressive.
3. **Temps moyen d’un audit** = durée entre le début du parcours et la génération du rapport.
4. **Nombre d’écarts identifiés** = nombre de règles vérifiables/partielles dont la quantité observée diffère de la quantité attendue.

Les KPI de précision/rappel doivent être mesurés sur des images annotées. Ils ne doivent pas être présentés comme mesurés tant que les essais n’ont pas été exécutés.

## 5. Plan de tests

Le protocole détaillé se trouve dans `TESTS.md`. Les cas prioritaires sont :

| Test | Résultat attendu | Statut |
|---|---|---|
| Syntaxe JavaScript | `node --check app.js` sans erreur | Validé dans la version fournie |
| Cohérence statique du dépôt | `node tests/static-check.mjs` sans erreur | Validé dans la version fournie |
| Image avec plusieurs chaises | Cadres et quantités cohérents avec contrôle humain | À exécuter navigateur |
| Comparaison Équilibré / Précis | Vérifier le gain de rappel et l’absence de doubles comptages évidents | À exécuter navigateur |
| Seuil 35 → 60 → 25 % | Les détections peuvent disparaître puis réapparaître sans relancer l’analyse | À exécuter navigateur |
| Refus caméra | Message explicite ; import toujours disponible | À exécuter navigateur |
| Modèle indisponible | État d’erreur explicite ; analyse désactivée | À exécuter navigateur |
| Rapport | Contexte, résultats, attendu/observé, écarts, limites, recommandations | À exécuter navigateur |
| Image contenant une personne | Ne pas lancer l’analyse ; recadrer/choisir une autre image | Contrôle opérateur obligatoire |

## 6. Risques et mesures

| Risque | Impact | Mesure de maîtrise |
|---|---|---|
| Faux négatifs | Sous-comptage | Multi-passes, mode Précis, seuil ajustable, seconde vue recommandée |
| Faux positifs | Sur-comptage | Scores visibles, seuil utilisateur, fusion/dédoublonnage, filtre qualité géométrique et confirmation multi-vues |
| Faux positifs de bord | Boîtes dans des zones vides | Rejet des candidats faibles isolés au bord, sauf confirmation multi-vues ou multi-moteurs |
| Doubles détections entre tuiles | Comptage artificiellement élevé | Dédoublonnage par classe avec IoU/recouvrement/proximité |
| Tables de cours mal couvertes par `dining table` | Audit trompeur | Complément OWL-ViT zero-shot + statut indicatif + contrôle humain |
| Classes absentes du modèle | Quantités non vérifiables | « Non vérifiable » explicite ; aucune détection inventée |
| Image contenant une personne | Non-respect de la consigne | Confirmation du cadrage sans personne ; ne pas analyser l’image concernée |
| Temps de calcul élevé en mode Précis | Expérience plus lente | Trois profils de calcul ; mode Équilibré par défaut |
| COCO/CDN indisponible | Détection principale indisponible | Message d’erreur et analyse désactivée |
| OWL-ViT indisponible ou trop lent | Couverture hybride réduite | Chargement à la demande, repli COCO automatique, catégories concernées marquées non vérifiables |
| Autorisation caméra refusée | Capture indisponible | Import d’image comme alternative |
| Rapport interprété comme preuve d’absence | Décision erronée | Mention explicite des limites et recommandation de seconde vue |
| Déploiement non validé | Démonstration inaccessible | Validation locale puis Cloudflare avant remise |

## 7. Qualité et validation

La version fournie inclut une vérification statique sans dépendance :

```bash
node --check app.js
node tests/static-check.mjs
```

Ces contrôles valident la syntaxe et la cohérence minimale des fichiers. Ils ne remplacent pas les tests navigateur, car la caméra, TensorFlow.js et Transformers.js dépendent du contexte HTTPS/localhost, des permissions, de la mémoire disponible et du chargement réseau.

Pour comparer objectivement l’ancienne et la nouvelle stratégie, annoter au moins trois images et relever TP/FP/FN et temps de calcul pour les modes Équilibré et Précis. Aucun gain chiffré ne doit être annoncé avant cette mesure.

## 8. Déploiement et remise

- Déposer `index.html`, `style.css`, `app.js`, `README.md`, `DOSSIER_PROJET.md`, `TESTS.md` et le dossier `tests/` dans le dépôt GitHub `epita-smart-classroom`.
- Enregistrer des commits explicites et conserver l’historique.
- Connecter le dépôt à Cloudflare Pages : branche `main`, aucune commande de build (ou `exit 0`), sortie `/` si les fichiers sont à la racine.
- Vérifier l’URL publique, le chargement du modèle, l’import, la caméra, les trois modes d’analyse, l’audit et le rapport.
- Ajouter l’URL Cloudflare au README après déploiement réel.

## 9. Étape suivante après le MVP

Si l’objectif devient une reconnaissance très fiable des tables de classe, tableaux, fenêtres et équipements spécifiques, le meilleur levier n’est plus d’ajouter des heuristiques à COCO-SSD : il faut constituer un petit jeu d’images de salles annotées et utiliser un modèle spécialisé/fine-tuné. Le MVP actuel reste volontairement compatible navigateur et conforme à la consigne d’utiliser un modèle pré-entraîné existant.
