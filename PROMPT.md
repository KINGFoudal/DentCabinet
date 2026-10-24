# Prompt : Nimba Dentaire

Copie tout ce qui suit dans une nouvelle session pour lancer la création.

---

## Contexte

Construis **Nimba Dentaire**, un logiciel SaaS de gestion de cabinets dentaires destiné à la **Guinée** (Afrique de l'Ouest). Plusieurs cabinets s'abonnent à la même plateforme. Chaque cabinet ne voit que ses propres données.

Contraintes du terrain à respecter partout :
- **Connexion internet instable** : coupures fréquentes et débit faible. L'application doit rester utilisable hors ligne pour les tâches courantes, puis se synchroniser au retour du réseau.
- **Paiement mobile** : Orange Money et MTN Mobile Money, et non la carte bancaire.
- **Devise** : franc guinéen (GNF), sans décimales. Format : `150 000 GNF`.
- **Langues** : français par défaut, anglais en option. Toutes les chaînes doivent passer par un système de traduction dès le départ.
- **Données de santé** : à protéger selon la législation guinéenne sur les données personnelles. Le point juridique est à faire valider par un juriste local ; le code doit appliquer au minimum le chiffrement, le contrôle d'accès par rôle et la journalisation des accès.

## Stack technique

- **Frontend** : Next.js (App Router), TypeScript, Tailwind CSS. Application web responsive (PC, tablette, téléphone), installable en **PWA**.
- **Backend** : Supabase (Postgres, Auth, Storage, Edge Functions).
- **Multi-tenant** : chaque table métier porte un `cabinet_id`. L'isolation est imposée par des politiques **Row Level Security** dans Postgres, jamais seulement dans le code de l'application.
- **Hors ligne** : service worker, base locale IndexedDB, file d'attente des modifications, synchronisation au retour du réseau avec gestion des conflits. Règle par défaut : dernière écriture gagnante, avec historique conservé ; pour les rendez-vous, un conflit de créneau doit être signalé à l'utilisateur, jamais écrasé en silence.
- **Déploiement** : Vercel pour le frontend, Supabase pour le backend.
- Utiliser les versions stables actuelles des bibliothèques et vérifier leur documentation au lieu de deviner les API.

## Rôles et permissions

| Rôle | Accès |
|---|---|
| Super-admin plateforme | Gère les cabinets, les abonnements, le support. N'accède pas aux dossiers médicaux. |
| Administrateur cabinet | Paramètres du cabinet, utilisateurs, tarifs des actes, abonnement, tous les rapports. |
| Dentiste / praticien | Son agenda, dossiers patients complets, plans de traitement, devis. |
| Secrétaire / assistant(e) | Accueil, rendez-vous, fiches administratives, encaissements. Pas d'accès aux notes cliniques détaillées. |
| Comptable | Lecture seule : factures, paiements, rapports financiers, exports. |
| Patient | Espace patient en ligne (voir module 4). |

Un utilisateur peut appartenir à plusieurs cabinets (cas d'un dentiste qui exerce dans deux cabinets), avec un rôle par cabinet.

## Modules de la V1

### 1. Agenda et rendez-vous
- Vue jour, semaine et mois, par praticien et par fauteuil.
- Création, déplacement par glisser-déposer, annulation, absence du patient.
- Types de rendez-vous avec durée et couleur (consultation, détartrage, extraction, soin de carie, prothèse, urgence...).
- Salle d'attente : statuts arrivé, en soin, terminé.
- Horaires d'ouverture, congés et indisponibilités par praticien.
- **Rappels** : WhatsApp (WhatsApp Business Cloud API) et email, envoyés automatiquement la veille et le jour même. Modèles de message modifiables par le cabinet. Journal des envois et de leur statut.

### 2. Dossier patient
- Fiche administrative : nom, sexe, date de naissance, téléphone (format guinéen +224), quartier/ville, personne à contacter, profession.
- Antécédents médicaux, allergies, traitements en cours, alertes bien visibles (diabète, anticoagulants, grossesse...).
- **Schéma dentaire interactif** en numérotation FDI (adulte et enfant) : état de chaque dent, soins réalisés et soins prévus.
- Plan de traitement par étapes, lié aux devis.
- Notes cliniques datées et signées par le praticien.
- Pièces jointes : radios, photos, ordonnances, documents scannés (Supabase Storage, compression des images pour les connexions lentes).
- Ordonnances imprimables avec en-tête du cabinet.
- Historique complet des rendez-vous, soins et paiements.
- Champ « assurance » simple sur la fiche (nom de l'assureur, numéro), sans gestion des remboursements en V1.

### 3. Devis et facturation
- Catalogue d'actes et de tarifs propre à chaque cabinet.
- Devis générés depuis le plan de traitement, imprimables en PDF, acceptés ou refusés.
- Factures, paiements partiels, échéanciers, suivi des impayés.
- Moyens de paiement enregistrés : espèces, Orange Money, MTN Mobile Money, virement.
- Reçus PDF, numérotation séquentielle des factures par cabinet.
- Tableau de bord : chiffre d'affaires du jour, du mois, impayés, actes les plus fréquents.
- Export CSV/Excel pour le comptable.

### 4. Espace patient en ligne
- Connexion par numéro de téléphone avec code à usage unique (OTP par WhatsApp ou SMS).
- Prise de rendez-vous en ligne sur les créneaux ouverts par le cabinet, annulation selon une règle configurable.
- Consultation de ses devis, factures, ordonnances et documents partagés par le cabinet.
- Paiement d'une facture par Orange Money ou MTN Mobile Money.
- Page publique par cabinet (adresse, horaires, praticiens, bouton de prise de RDV).

### 5. Abonnement SaaS
- Inscription d'un nouveau cabinet avec période d'essai.
- Formules d'abonnement (par exemple selon le nombre de praticiens), configurables par le super-admin.
- Paiement de l'abonnement par Orange Money et MTN Mobile Money.
- Relances avant échéance, mode lecture seule si l'abonnement expire (le cabinet ne perd jamais l'accès à ses données).

## Paiements mobiles

- Créer une couche `payments` avec une interface commune et un adaptateur par fournisseur (Orange Money, MTN MoMo), pour pouvoir changer de fournisseur ou passer par un agrégateur sans toucher au reste du code.
- Avant d'écrire l'intégration, vérifier dans la documentation officielle de chaque opérateur ce qui est disponible en Guinée (API marchand, environnement de test, webhooks). Si l'accès direct n'est pas possible, proposer un agrégateur qui couvre la Guinée.
- Les confirmations de paiement passent par des webhooks vérifiés côté serveur (Edge Function). Une transaction n'est jamais marquée payée depuis le navigateur.
- Gérer les cas réels : paiement en attente, expiré, échoué, payé deux fois.

## Sécurité et traçabilité

- Authentification Supabase, mots de passe forts, double authentification proposée aux administrateurs.
- RLS sur toutes les tables, testée par des tests automatiques (un utilisateur d'un cabinet A ne doit jamais lire une ligne du cabinet B).
- Journal d'audit : qui a consulté ou modifié quel dossier, et quand.
- Fichiers stockés dans des buckets privés, accès par URL signées à durée courte.
- Sauvegardes quotidiennes et procédure de restauration documentée.
- Les données mises en cache hors ligne sur l'appareil sont limitées au nécessaire et effacées à la déconnexion.

## Interface

- Sobre, lisible, pensée pour un usage rapide à l'accueil et au fauteuil.
- Fonctionne bien sur une tablette Android d'entrée de gamme et sur une connexion 3G : pages légères, images optimisées, pas de dépendances lourdes inutiles.
- Indicateur permanent de l'état de connexion et des modifications en attente de synchronisation.
- Accessible : contrastes suffisants, navigation au clavier, tailles de texte lisibles.

## Livrables attendus

1. Schéma de base de données (migrations SQL Supabase) avec politiques RLS.
2. Application Next.js complète pour les cinq modules.
3. Edge Functions : rappels WhatsApp/email, webhooks de paiement, génération de PDF si nécessaire.
4. Données de démonstration : un cabinet fictif, praticiens, patients, rendez-vous et factures.
5. Tests : RLS multi-tenant, synchronisation hors ligne, calculs de facturation, parcours principaux (Playwright).
6. README : installation locale, variables d'environnement, déploiement, ajout d'un fournisseur de paiement.

## Méthode de travail

- Commencer par proposer l'architecture, le schéma de données et un découpage en étapes, puis attendre validation avant de coder.
- Livrer module par module, dans cet ordre : socle (auth, multi-tenant, rôles, hors ligne), dossier patient, agenda, facturation, espace patient, abonnement.
- Après chaque étape : lancer les tests, le linter et le typage, et montrer l'application qui tourne.
- Poser une question dès qu'un choix métier n'est pas couvert par ce document au lieu de l'inventer.

## Hors périmètre V1 (à prévoir dans l'architecture)

- Gestion des remboursements d'assurance (part assurance / part patient).
- Application mobile native.
- Gestion de stock (consommables, matériel).
- Rappels par SMS.
- Interface en arabe ou en langues locales.
