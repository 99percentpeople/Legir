import type { LandingCopy } from "./types";

export const es: LandingCopy = {
  nav: {
    features: "Funciones",
    workflow: "Cómo empezar",
    faq: "Preguntas",
    menu: "Abrir menú",
    close: "Cerrar menú",
    skip: "Saltar al contenido",
    home: "Inicio de Legir",
  },
  hero: {
    eyebrow: "TUS DOCUMENTOS. TU ESPACIO.",
    title: "Un poco menos de ruido.",
    accent: "Mucha más claridad.",
    description:
      "Un espacio tranquilo para tus PDF. Lee, anota y rellena formularios, con tus archivos donde deben estar: en tu dispositivo.",
    cta: "Abrir Legir",
    source: "Ver en GitHub",
    note: "En tu navegador · Primero local · Código abierto",
  },
  preview: {
    label: "Demo interactiva de Legir",
    modes: {
      read: "Leer",
      annotate: "Anotar",
      forms: "Formularios",
      ai: "Consultar IA",
      translate: "Traducir",
    },
    caption:
      "Demo interactiva con datos de ejemplo. Las entradas quedan en memoria; las respuestas y traducciones son locales. Abre Legir para editar tus documentos.",
    appLabel: "Abrir Legir",
  },
  features: {
    eyebrow: "MENOS FRICCIÓN. MÁS CONCENTRACIÓN.",
    title: "Todo para tu próxima página.",
    description:
      "De la primera lectura a la última revisión. Las herramientas que necesitas, sin estorbar.",
    items: [
      {
        title: "Encuentra tu ritmo de lectura.",
        description:
          "Navega con miniaturas, índice y búsqueda. Reabre un documento reciente y vuelve a lo importante.",
      },
      {
        title: "Un lugar para tus ideas.",
        description:
          "Resalta un pasaje, deja un comentario o dibuja en los márgenes. Conserva tus ideas junto al original.",
      },
      {
        title: "Formularios sin rodeos.",
        description:
          "Rellena o crea campos de texto, casillas y otros controles. Exporta tu trabajo a PDF cuando esté listo.",
      },
      {
        title: "Otra perspectiva, cuando la necesites.",
        description:
          "Explora tus documentos con IA opcional. Elige el proveedor y configura tu clave API en los ajustes de la aplicación.",
      },
    ],
    tags: [
      "Un espacio para concentrarse",
      "Resaltado · Notas · Dibujo",
      "Rellenar · Crear · Exportar",
      "Tu proveedor. Tu decisión.",
    ],
  },
  privacy: {
    eyebrow: "LOCAL POR DISEÑO",
    title: "Tus archivos siguen\nen tus manos.",
    description:
      "La lectura, las anotaciones y los formularios se procesan en tu dispositivo. No hace falta enviar tu PDF a un servidor para el trabajo diario.",
    detail:
      "La IA es opcional. Al usar servicios de IA o traducción, el contenido pertinente se envía al proveedor que configures.",
    badge: "Primero local, sin depender de la nube",
  },
  workflow: {
    eyebrow: "UNA FORMA MÁS SIMPLE DE TRABAJAR",
    title: "Abre. Hazlo tuyo. Continúa.",
    steps: [
      {
        title: "Trae un documento",
        description:
          "Abre la aplicación en el navegador y un PDF de tu dispositivo.",
      },
      {
        title: "Trabaja a tu manera",
        description:
          "Lee, añade notas, rellena formularios o usa tu IA configurada.",
      },
      {
        title: "Llévate tu trabajo",
        description:
          "Exporta el resultado como PDF, listo para lo que venga después.",
      },
    ],
  },
  faq: {
    title: "Antes de empezar, algunas respuestas.",
    items: [
      {
        title: "¿Tengo que subir mi PDF?",
        description:
          "No. La lectura, las anotaciones y los formularios se procesan localmente. Solo los servicios opcionales de IA y traducción envían el contenido pertinente al proveedor configurado.",
      },
      {
        title: "¿Puedo usar Legir sin IA?",
        description:
          "Sí. La IA es opcional. Puedes leer, navegar, anotar y trabajar con formularios sin configurar un proveedor de IA ni una clave API.",
      },
      {
        title: "¿Dónde puedo usar Legir?",
        description:
          "Abre la aplicación web en tu navegador. El proyecto también incluye una aplicación de escritorio Tauri. El código fuente y las instrucciones de compilación están en GitHub bajo la licencia AGPL-3.0-or-later.",
      },
    ],
  },
  closing: {
    title: "Tu próxima gran idea empieza en una página.",
    description: "Dale un poco de espacio. Abre un PDF en Legir.",
  },
  footer: {
    tagline: "Un lugar más tranquilo para tus PDF.",
    license: "Código abierto · AGPL-3.0-or-later",
  },
};
