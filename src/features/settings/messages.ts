// Textes du module « settings ». Chaque clé doit exister en fr et en en.
export const messages = {
  fr: {
    settings: {
      sections: {
        cabinet: "Cabinet",
        cabinetDesc: "Nom, coordonnées, horaires d'ouverture, page publique",
        team: "Équipe",
        teamDesc: "Utilisateurs, rôles et invitations",
        agenda: "Agenda",
        agendaDesc: "Fauteuils, types de rendez-vous, horaires des praticiens",
        acts: "Actes et tarifs",
        actsDesc: "Catalogue des actes et prix en GNF",
        messages: "Messages et rappels",
        messagesDesc: "Modèles WhatsApp et email",
      },
    },
  },
  en: {
    settings: {
      sections: {
        cabinet: "Practice",
        cabinetDesc: "Name, contact details, opening hours, public page",
        team: "Team",
        teamDesc: "Users, roles and invitations",
        agenda: "Calendar",
        agendaDesc: "Chairs, appointment types, dentist hours",
        acts: "Procedures and prices",
        actsDesc: "Procedure catalogue and prices in GNF",
        messages: "Messages and reminders",
        messagesDesc: "WhatsApp and email templates",
      },
    },
  },
} as const;
