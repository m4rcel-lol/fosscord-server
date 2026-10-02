import { MigrationInterface, QueryRunner } from "typeorm";

const CATEGORIES = [
    { id: 0, name: "General", is_primary: true, localizations: {} },
    { id: 1, name: "Gaming", is_primary: true, localizations: { de: "Gaming", fr: "Gaming", ru: "Игры" } },
    { id: 2, name: "Music", is_primary: true, localizations: { de: "Musik", fr: "Musique", ru: "Музыка" } },
    { id: 3, name: "Entertainment", is_primary: true, localizations: { de: "Unterhaltung", fr: "Divertissements", ru: "Развлечение" } },
    { id: 4, name: "Creative Arts", is_primary: true, localizations: { de: "Kreative Künste", fr: "Arts créatifs", ru: "Искусство" } },
    { id: 5, name: "Science & Tech", is_primary: true, localizations: { de: "Wissenschaft & Technik", fr: "Science et technologie", ru: "Наука и техника" } },
    { id: 6, name: "Education", is_primary: true, localizations: { de: "Lernen", fr: "Éducation", ru: "Образование" } },
    { id: 7, name: "Sports", is_primary: true, localizations: { de: "Sport", fr: "Sports", ru: "Спорт" } },
    { id: 8, name: "Fashion & Beauty", is_primary: true, localizations: { de: "Fashion & Beauty", fr: "Mode et beauté", ru: "Мода и красота" } },
    {
        id: 9,
        name: "Relationships & Identity",
        is_primary: true,
        localizations: { de: "Beziehungen & Identität", fr: "Relations et identité", ru: "Отношения и самоидентификация" },
    },
    { id: 10, name: "Travel & Food", is_primary: true, localizations: { de: "Reisen & Essen", fr: "Voyage et nourriture", ru: "Путешествия и еда" } },
    { id: 11, name: "Fitness & Health", is_primary: true, localizations: { de: "Fitness & Gesundheit", fr: "Fitness et santé", ru: "Фитнес и здоровье" } },
    { id: 12, name: "Finance", is_primary: true, localizations: { de: "Finanzen", fr: "Finance", ru: "Финансы" } },
    { id: 13, name: "Other", is_primary: true, localizations: { de: "Sonstiges", fr: "Autre", ru: "Другое" } },
    { id: 14, name: "General Chatting", is_primary: true, localizations: { de: "Allgemeine Chats", fr: "Discussion générale", ru: "Общение" } },
    { id: 15, name: "Esports", is_primary: false, localizations: { de: "E-Sports", fr: "eSport", ru: "Киберспорт" } },
    { id: 16, name: "Anime & Manga", is_primary: false, localizations: { de: "Anime & Manga", fr: "Animés et mangas", ru: "Аниме и манга" } },
    { id: 17, name: "Movies & TV", is_primary: false, localizations: { de: "Film & TV", fr: "Films et TV", ru: "Кино и телевидение" } },
    { id: 18, name: "Books", is_primary: false, localizations: { de: "Bücher", fr: "Livres", ru: "Книги" } },
    { id: 19, name: "Art", is_primary: false, localizations: { de: "Kunst", fr: "Art", ru: "Творчество" } },
    { id: 20, name: "Writing", is_primary: false, localizations: { de: "Schreiben", fr: "Écriture", ru: "Литература" } },
    {
        id: 21,
        name: "Crafts, DIY, & Making",
        is_primary: false,
        localizations: { de: "Basteln & Handwerk", fr: "Travaux manuels, bricolage et artisanat", ru: "Хобби, рукоделие" },
    },
    { id: 22, name: "Programming", is_primary: false, localizations: { de: "Programmieren", fr: "Programmation", ru: "Программирование" } },
    { id: 23, name: "Podcasts", is_primary: false, localizations: { de: "Podcasts", fr: "Podcasts", ru: "Подкасты" } },
    { id: 24, name: "Tabletop Games", is_primary: false, localizations: { de: "Tabletop-Spiele", fr: "Jeux de société", ru: "Настольные игры" } },
    { id: 25, name: "Memes", is_primary: false, localizations: { de: "Memes", fr: "Memes", ru: "Мемы" } },
    { id: 26, name: "News & Current Events", is_primary: false, localizations: { de: "Nachrichten & Zeitgeschehen", fr: "Actualité", ru: "Новости и текущие события" } },
    { id: 27, name: "Cryptocurrency", is_primary: false, localizations: { de: "Kryptowährung", fr: "Cryptomonnaie", ru: "Криптовалюта" } },
    { id: 28, name: "Investing", is_primary: false, localizations: { de: "Geldanlage", fr: "Investissements", ru: "Инвестиции" } },
    { id: 29, name: "Studying & Teaching", is_primary: false, localizations: { de: "Lernen & Lehren", fr: "Études et enseignement", ru: "Обучение" } },
    { id: 30, name: "LFG", is_primary: false, localizations: { de: "LFG", fr: "LFG", ru: "Поиск группы" } },
    { id: 31, name: "Customer Support", is_primary: false, localizations: { de: "Kundensupport", fr: "Assistance clientèle", ru: "Служба поддержки" } },
    { id: 32, name: "Theorycraft", is_primary: false, localizations: { de: "Theorycraft", fr: "Theorycraft", ru: "Теорикрафтинг" } },
    { id: 33, name: "Events", is_primary: false, localizations: { de: "Events", fr: "Événements", ru: "Мероприятия" } },
    { id: 34, name: "Roleplay", is_primary: false, localizations: { de: "Rollenspiele", fr: "Jeux de rôles", ru: "Ролевая игра" } },
    { id: 35, name: "Content Creator", is_primary: false, localizations: { de: "Content Creator", fr: "Créateur de contenu", ru: "Создатель контента" } },
    { id: 36, name: "Business", is_primary: false, localizations: { de: "Unternehmen", fr: "Activités commerciales", ru: "Бизнес" } },
    { id: 37, name: "Local Group", is_primary: false, localizations: { de: "Lokale Gruppen", fr: "Groupe local", ru: "Местная группа" } },
    { id: 38, name: "Collaboration", is_primary: false, localizations: { de: "Kollaboration", fr: "Collaboration", ru: "Совместная работа" } },
    { id: 39, name: "Fandom", is_primary: false, localizations: { de: "Fan-Community", fr: "Communauté de fans", ru: "Фанатское сообщество" } },
    { id: 40, name: "Wiki & Guide", is_primary: false, localizations: { de: "Wiki & Anleitungen", fr: "Wiki et guide", ru: "Вики и руководство" } },
    { id: 42, name: "Subreddit", is_primary: false, localizations: { de: "Subreddit", fr: "Subreddit", ru: "Сабреддит" } },
    { id: 43, name: "Emoji", is_primary: true, localizations: { de: "Emoji", fr: "Émoji", ru: "Эмодзи" } },
    { id: 44, name: "Comics & Cartoons", is_primary: false, localizations: {} },
    { id: 45, name: "Mobile", is_primary: false, localizations: {} },
    { id: 46, name: "Console", is_primary: false, localizations: {} },
    { id: 47, name: "Charity & Nonprofit", is_primary: false, localizations: {} },
    { id: 48, name: "Game Developer", is_primary: false, localizations: {} },
    { id: 49, name: "Bots", is_primary: true, localizations: {} },
];

export class DiscoveryCategories1791052946381 implements MigrationInterface {
    name = "DiscoveryCategories1791052946381";

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const category of CATEGORIES)
            await queryRunner.query(`INSERT INTO "categories" ("id", "name", "localizations", "is_primary") VALUES ($1, $2, $3, $4) ON CONFLICT ("id") DO NOTHING`, [
                category.id,
                category.name,
                JSON.stringify(category.localizations),
                category.is_primary,
            ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "categories" WHERE "id" = ANY($1)`, [CATEGORIES.map((category) => category.id)]);
    }
}
