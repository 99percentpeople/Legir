import type { LandingCopy } from "./types";

export const fr: LandingCopy = {
  nav: {
    features: "Fonctions",
    workflow: "Premiers pas",
    faq: "Questions",
    menu: "Ouvrir le menu",
    close: "Fermer le menu",
    skip: "Aller au contenu",
    home: "Accueil Legir",
  },
  hero: {
    eyebrow: "VOS DOCUMENTS. VOTRE ESPACE.",
    title: "Moins de bruit.",
    accent: "Plus de clarté.",
    description:
      "Un espace serein pour vos PDF. Lisez, annotez et remplissez des formulaires, en gardant vos fichiers sur votre appareil.",
    cta: "Ouvrir Legir",
    source: "Voir sur GitHub",
    note: "Dans votre navigateur · Local d’abord · Open source",
  },
  preview: {
    label: "Démo interactive de Legir",
    modes: {
      read: "Lire",
      annotate: "Annoter",
      forms: "Formulaires",
      ai: "IA",
      translate: "Traduire",
    },
    caption:
      "Démo d’interface, pas l’éditeur complet. Saisies en mémoire uniquement ; IA et traductions prédéfinies, sans envoi de contenu. Ouvrez Legir pour vos PDF.",
    appLabel: "Ouvrir Legir",
  },
  features: {
    eyebrow: "MOINS D’OBSTACLES. PLUS D’ATTENTION.",
    title: "Tout pour votre prochaine page.",
    description:
      "De la première lecture à la dernière relecture. Les bons outils, sans distractions.",
    items: [
      {
        title: "Retrouvez votre rythme.",
        description:
          "Naviguez avec les miniatures, le sommaire et la recherche. Rouvrez un document récent pour revenir à l’essentiel.",
      },
      {
        title: "Une place pour vos idées.",
        description:
          "Surlignez un passage, laissez un commentaire ou dessinez dans les marges. Gardez vos réflexions près du texte.",
      },
      {
        title: "Simplifiez les formulaires.",
        description:
          "Remplissez ou créez des champs de texte, des cases à cocher et d’autres contrôles. Exportez ensuite votre travail en PDF.",
      },
      {
        title: "Un autre regard, au besoin.",
        description:
          "Explorez le document avec l’IA facultative. Choisissez votre fournisseur et configurez la clé API dans l’application.",
      },
    ],
    tags: [
      "Un espace de lecture serein",
      "Surlignage · Notes · Dessin",
      "Remplir · Créer · Exporter",
      "Votre fournisseur, votre choix",
    ],
  },
  privacy: {
    eyebrow: "LOCAL PAR CONCEPTION",
    title: "Vos fichiers restent\nentre vos mains.",
    description:
      "Lecture, annotations et formulaires sont traités sur votre appareil. Pas besoin d’envoyer votre PDF à un serveur pour le travail quotidien.",
    detail:
      "L’IA est facultative. Les services d’IA ou de traduction reçoivent le contenu concerné auprès du fournisseur que vous configurez.",
    badge: "Local d’abord, sans cloud imposé",
  },
  workflow: {
    eyebrow: "UNE FAÇON PLUS SIMPLE DE TRAVAILLER",
    title: "Ouvrez. Appropriez-vous. Continuez.",
    steps: [
      {
        title: "Apportez un document",
        description:
          "Ouvrez l’application dans le navigateur, puis un PDF de votre appareil.",
      },
      {
        title: "Travaillez à votre façon",
        description:
          "Lisez, annotez, remplissez des formulaires ou utilisez l’IA configurée.",
      },
      {
        title: "Emportez votre travail",
        description: "Exportez le résultat en PDF, prêt pour la suite.",
      },
    ],
  },
  faq: {
    title: "Quelques questions avant de commencer.",
    items: [
      {
        title: "Dois-je téléverser mon PDF ?",
        description:
          "Non. La lecture, les annotations et les formulaires sont traités localement. Les services facultatifs d’IA et de traduction envoient le contenu concerné au fournisseur configuré.",
      },
      {
        title: "Puis-je utiliser Legir sans IA ?",
        description:
          "Oui. L’IA est facultative. Lisez, naviguez, annotez et travaillez sur les formulaires sans fournisseur d’IA ni clé API.",
      },
      {
        title: "Où puis-je utiliser Legir ?",
        description:
          "Ouvrez l’application web dans votre navigateur. Le projet comprend aussi une application de bureau Tauri. Le code source et les instructions de compilation sont sur GitHub, sous licence AGPL-3.0-or-later.",
      },
    ],
  },
  closing: {
    title: "Votre prochaine idée commence sur une page.",
    description: "Faites-lui un peu de place. Ouvrez un PDF dans Legir.",
  },
  footer: {
    tagline: "Un endroit plus calme pour vos PDF.",
    license: "Open source · AGPL-3.0-or-later",
  },
};
