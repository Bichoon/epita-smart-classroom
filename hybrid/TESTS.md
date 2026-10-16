# Plan de validation — EPITA Smart Classroom

## 1. Contrôles statiques exécutables

```bash
node --check app.js
node tests/static-check.mjs
```

Ces contrôles vérifient la syntaxe JavaScript et plusieurs invariants du dépôt. Ils ne chargent ni TensorFlow.js, ni OWL-ViT, ni la caméra.

## 2. Jeu de test fourni

- `test-classroom.jpg` : photo de salle autorisée, sans personne visible.
- `baseline-detection.png` : ancienne capture permettant de repérer les faux positifs et sous-détections de la version précédente.

## 3. Tests fonctionnels prioritaires

| ID | Scénario | Procédure | Résultat attendu | Statut |
|---|---|---|---|---|
| T01 | Chargement COCO | Ouvrir avec Internet | « COCO prêt · complémentaire à la demande » | À exécuter |
| T02 | Import image | Importer `test-classroom.jpg` | Image affichée, analyse activable après confirmation vie privée | À exécuter |
| T03 | Faux positif angle haut gauche | Mode Équilibré, seuil 25–35 % | Les faibles boîtes isolées dans une zone vide doivent être rejetées sauf confirmation multi-vues | À exécuter |
| T04 | Chaises | Mode Équilibré puis Précis | La majorité des chaises évidentes doit être retrouvée sans forte hausse des doublons | À exécuter |
| T05 | Tables/bureaux hybride | Comparer « COCO uniquement » puis « Hybride » | Le mode hybride doit pouvoir ajouter des détections `desk/table` réellement retournées par OWL-ViT | À exécuter |
| T06 | Tableau blanc | Mode Hybride | Une sortie OWL-ViT peut apparaître ; elle doit être présentée comme indicateur expérimental | À exécuter |
| T07 | Fenêtres | Mode Hybride | Sorties éventuelles affichées comme indicatives ; aucune invention si le modèle ne retourne rien | À exécuter |
| T08 | Écrans/moniteurs | Comparer COCO et Hybride | Fusion/dédoublonnage si les deux moteurs voient le même écran | À exécuter |
| T09 | Seuil montant puis descendant | Après analyse : 35 → 60 → 20 % | Les résultats peuvent disparaître puis réapparaître sans relancer l’inférence | À exécuter |
| T10 | Quantité attendue au clavier | Modifier une valeur | Écart, statut et KPI mis à jour immédiatement sans perte de focus | À exécuter |
| T11 | Boutons − / + | Cliquer plusieurs fois | La quantité attendue et l’audit changent à chaque clic | À exécuter |
| T12 | Refus caméra | Refuser l’autorisation | Message explicite ; import image toujours utilisable | À exécuter |
| T13 | OWL indisponible | Bloquer Hugging Face/jsDelivr après chargement COCO | L’analyse COCO continue ; catégories OWL marquées non vérifiables automatiquement | À exécuter |
| T14 | Capture caméra | Autoriser, capturer | Instantané fixe visible avant analyse | À exécuter |
| T15 | Rapport | Après analyse hybride | Rapport avec moteurs utilisés, passes, attendu/observé, limites et recommandations | À exécuter |

## 4. Mesure de performance

Pour au moins trois images de salle sans personne, annoter manuellement :

- nombre réel de chaises ;
- nombre réel de tables/bureaux ;
- laptops ;
- écrans ;
- tableaux blancs ;
- fenêtres.

Pour chaque configuration `COCO / Hybride × Équilibré / Précis`, relever :

- vrais positifs ;
- faux positifs ;
- faux négatifs ;
- précision = TP / (TP + FP) ;
- rappel = TP / (TP + FN) ;
- durée d’analyse.

Ne pas annoncer de gain chiffré tant que ces mesures navigateur n’ont pas été exécutées.

## 5. Critère spécifique du filtre qualité

L’ancienne capture montre des prédictions faibles dans une zone vide en haut à gauche. Pour valider la correction :

1. analyser la même image à faible seuil ;
2. vérifier si ces prédictions sont isolées ou confirmées ;
3. vérifier qu’un candidat faible touchant le bord est rejeté s’il n’est confirmé ni par plusieurs passes ni par un second moteur ;
4. s’assurer qu’un vrai objet partiellement coupé au bord peut rester détecté lorsqu’il est confirmé.
