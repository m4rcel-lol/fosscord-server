/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Request, Response, Router } from "express";
import { ILike } from "typeorm";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Member, Relationship, User } from "@spacebar/database";
import {
    Config,
    DiscordApiErrors,
    FieldErrors,
    PresenceUpdateEvent,
    RelationshipAddEvent,
    RelationshipRemoveEvent,
    RelationshipUpdateEvent,
    emitEvent,
    getUserPresence,
} from "@spacebar/util";
import { PublicUserProjection, RelationshipType, RelationshipModifySchema, RelationshipListSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const userProjection: (keyof User)[] = ["relationships", ...PublicUserProjection];
const MAX_NOTE_LENGTH = 120;

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "RelationshipListSchema",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            relations: { relationships: { to: true } },
            select: { id: true, relationships: true },
        });

        const related_users = user.relationships.map((r) => r.toPublicRelationship());
        return res.json(related_users satisfies RelationshipListSchema);
    },
);

router.put(
    "/:user_id",
    route({
        requestBody: "RelationshipCreateSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) =>
        await updateRelationship(
            req,
            res,
            await User.findOneOrFail({
                where: { id: req.params.user_id as string },
                relations: { relationships: { to: true } },
                select: Object.fromEntries(userProjection.map((i) => [i, true])), // TODO: cleanup
            }),
            req.body.type ?? RelationshipType.FRIEND,
        ),
);

router.patch(
    "/:user_id",
    route({
        requestBody: "RelationshipModifySchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as RelationshipModifySchema;
        const rel = await Relationship.findOneOrFail({
            where: {
                from_id: req.user_id,
                to_id: req.params.user_id as string,
            },
        });
        rel.nickname = body.nickname;
        await Promise.all([
            emitEvent({
                event: "RELATIONSHIP_UPDATE",
                data: {
                    ...rel.toPublicRelationship(),
                    // should_notify: true, // TODO: this apparently isn't valid?
                },
                user_id: req.user_id,
            } satisfies RelationshipUpdateEvent),
            rel.save(),
        ]);
        res.send(204);
    },
);

router.post(
    "/",
    route({
        requestBody: "SendRelationshipRequestSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) =>
        await updateRelationship(
            req,
            res,
            await User.findOneOrFail({
                relations: { relationships: { to: true } },
                select: Object.fromEntries(userProjection.map((i) => [i, true])), // TODO: cleanup
                where:
                    req.body.discriminator && Number(req.body.discriminator) !== 0
                        ? {
                              discriminator: String(req.body.discriminator).padStart(4, "0"), //Discord send the discriminator as integer, we need to add leading zeroes
                              username: req.body.username,
                          }
                        : { discriminator: "0", username: ILike(String(req.body.username).replace(/[\\%_]/g, "\\$&")) },
            }),
            req.body.type, // TODO: is this even correct? the schema doesnt have a type field...
        ),
);

router.put("/:user_id/ignore", route({ responses: { 204: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { user_id } = req.params as { [key: string]: string };
    if (user_id === req.user_id) throw new HTTPError("You can't ignore yourself");
    const target = await User.findOneOrFail({ where: { id: user_id }, select: { id: true } });
    const existing = await Relationship.findOne({ where: { from_id: req.user_id, to_id: target.id }, relations: { to: true } });
    const relationship = existing ?? Relationship.create({ from_id: req.user_id, to_id: target.id, type: RelationshipType.NONE, since: new Date() });
    relationship.user_ignored = true;
    await relationship.save();
    const saved = existing ?? (await Relationship.findOneOrFail({ where: { id: relationship.id }, relations: { to: true } }));
    if (existing) await emitEvent({ event: "RELATIONSHIP_UPDATE", data: saved.toPublicRelationship(), user_id: req.user_id } satisfies RelationshipUpdateEvent);
    else await emitEvent({ event: "RELATIONSHIP_ADD", data: { ...saved.toPublicRelationship(), should_notify: false }, user_id: req.user_id } satisfies RelationshipAddEvent);
    res.sendStatus(204);
});

router.delete("/:user_id/ignore", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { user_id } = req.params as { [key: string]: string };
    const relationship = await Relationship.findOne({ where: { from_id: req.user_id, to_id: user_id }, relations: { to: true } });
    if (!relationship?.user_ignored) return res.sendStatus(204);
    relationship.user_ignored = false;
    if (relationship.type === RelationshipType.NONE) {
        await Relationship.delete({ id: relationship.id });
        await emitEvent({ event: "RELATIONSHIP_REMOVE", data: relationship.toPartialRelationship(), user_id: req.user_id } satisfies RelationshipRemoveEvent);
    } else {
        await relationship.save();
        await emitEvent({ event: "RELATIONSHIP_UPDATE", data: relationship.toPublicRelationship(), user_id: req.user_id } satisfies RelationshipUpdateEvent);
    }
    res.sendStatus(204);
});

router.delete(
    "/:user_id",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { user_id } = req.params as { [key: string]: string };
        if (user_id === req.user_id) throw new HTTPError("You can't remove yourself as a friend");

        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: Object.fromEntries(userProjection.map((i) => [i, true])), // TODO: cleanup
            relations: { relationships: true },
        });
        const friend = await User.findOneOrFail({
            where: { id: user_id },
            select: Object.fromEntries(userProjection.map((i) => [i, true])), // TODO: cleanup
            relations: { relationships: true },
        });

        const relationship = user.relationships.find((x) => x.to_id === user_id);
        const friendRequest = friend.relationships.find((x) => x.to_id === req.user_id);

        if (!relationship) throw new HTTPError("You are not friends with the user", 404);

        if (relationship?.type === RelationshipType.BLOCKED) {
            // unblock user
            await Promise.all([
                Relationship.delete({ id: relationship.id }),
                emitEvent({
                    event: "RELATIONSHIP_REMOVE",
                    user_id: req.user_id,
                    data: relationship.toPublicRelationship(),
                } satisfies RelationshipRemoveEvent),
            ]);
            return res.sendStatus(204);
        }
        if (friendRequest && friendRequest.type !== RelationshipType.BLOCKED) {
            await Promise.all([
                Relationship.delete({ id: friendRequest.id }),
                await emitEvent({
                    event: "RELATIONSHIP_REMOVE",
                    data: friendRequest.toPublicRelationship(),
                    user_id: user_id,
                } satisfies RelationshipRemoveEvent),
            ]);
        }

        await Promise.all([
            Relationship.delete({ id: relationship.id }),
            emitEvent({
                event: "RELATIONSHIP_REMOVE",
                data: relationship.toPublicRelationship(),
                user_id: req.user_id,
            } satisfies RelationshipRemoveEvent),
        ]);

        return res.sendStatus(204);
    },
);

async function updateRelationship(req: Request, res: Response, friend: User, type: RelationshipType) {
    const id = friend.id;
    if (id === req.user_id) throw DiscordApiErrors.CANNOT_FRIEND_SELF;

    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        relations: { relationships: { to: true } },
        select: Object.fromEntries(userProjection.map((i) => [i, true])), //TODO: cleanup
    });

    const note = typeof req.body?.note === "string" ? req.body.note.replace(/\n/g, " ").trim() : "";
    if (note.length > MAX_NOTE_LENGTH) throw FieldErrors({ note: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${MAX_NOTE_LENGTH} or fewer in length.` } });

    const ownRow = user.relationships.find((x) => x.to_id === id);
    const theirRow = friend.relationships.find((x) => x.to_id === req.user_id);
    let relationship = ownRow?.type === RelationshipType.NONE && type !== RelationshipType.BLOCKED ? undefined : ownRow;
    const friendRequest = theirRow?.type === RelationshipType.NONE ? undefined : theirRow;

    // TODO: you can add infinitely many blocked users (should this be prevented?)
    if (type === RelationshipType.BLOCKED) {
        if (relationship) {
            if (relationship.type === RelationshipType.BLOCKED) throw new HTTPError("You already blocked the user");
            relationship.type = RelationshipType.BLOCKED;
            await relationship.save();
        } else {
            relationship = await Relationship.create({
                to_id: id,
                type: RelationshipType.BLOCKED,
                from_id: req.user_id,
                since: new Date(),
            }).save();
        }

        if (friendRequest && friendRequest.type !== RelationshipType.BLOCKED) {
            await Promise.all([
                Relationship.delete({ id: friendRequest.id }),
                emitEvent({
                    event: "RELATIONSHIP_REMOVE",
                    data: friendRequest.toPartialRelationship(),
                    user_id: id,
                } satisfies RelationshipRemoveEvent),
            ]);
        }

        await emitEvent({
            event: "RELATIONSHIP_ADD",
            data: relationship.toPublicRelationship(),
            user_id: req.user_id,
        } satisfies RelationshipAddEvent);

        return res.sendStatus(204);
    }

    const { maxFriends } = Config.get().limits.user;
    if (user.relationships.length >= maxFriends) throw DiscordApiErrors.MAXIMUM_FRIENDS.withParams(maxFriends);

    let isStrangerRequest = true;
    const ownMemberships = (await Member.find({ where: { id: req.user_id }, select: { guild_id: true } })).map((x) => x.guild_id);
    const targetMemberships = (await Member.find({ where: { id }, select: { guild_id: true } })).map((x) => x.guild_id);

    if (ownMemberships.filter((x) => targetMemberships.includes(x)).length > 0) isStrangerRequest = false;

    let incoming_relationship = Relationship.create({
        ...(theirRow?.type === RelationshipType.NONE && { id: theirRow.id, user_ignored: theirRow.user_ignored }),
        nickname: undefined,
        type: RelationshipType.INCOMING_REQUEST,
        to: user,
        from: friend,
        since: new Date(),
        stranger_request: isStrangerRequest,
        note: note || undefined,
    });
    let outgoing_relationship = Relationship.create({
        ...(ownRow?.type === RelationshipType.NONE && { id: ownRow.id, user_ignored: ownRow.user_ignored }),
        nickname: undefined,
        type: RelationshipType.OUTGOING_REQUEST,
        to: friend,
        from: user,
        since: new Date(),
        note: note || undefined,
    });

    if (friendRequest) {
        if (friendRequest.type === RelationshipType.BLOCKED) throw DiscordApiErrors.FRIEND_REQUEST_BLOCKED;
        if (friendRequest.type === RelationshipType.FRIEND) throw DiscordApiErrors.ALREADY_FRIENDS;
        // accept friend request
        incoming_relationship = friendRequest;
        incoming_relationship.type = RelationshipType.FRIEND;
        incoming_relationship.note = null;
    }

    if (relationship) {
        if (relationship.type === RelationshipType.OUTGOING_REQUEST) throw new HTTPError("You already sent a friend request");
        if (relationship.type === RelationshipType.BLOCKED) throw new HTTPError("Unblock the user before sending a friend request");
        if (relationship.type === RelationshipType.FRIEND) throw DiscordApiErrors.ALREADY_FRIENDS;
        outgoing_relationship = relationship;
        outgoing_relationship.type = RelationshipType.FRIEND;
        outgoing_relationship.note = null;
    }

    await Promise.all([
        incoming_relationship.save(),
        outgoing_relationship.save(),
        emitEvent({
            event: "RELATIONSHIP_ADD",
            data: outgoing_relationship.toPublicRelationship(),
            user_id: req.user_id,
        } satisfies RelationshipAddEvent),
        emitEvent({
            event: "RELATIONSHIP_ADD",
            data: {
                ...incoming_relationship.toPublicRelationship(),
                should_notify: true,
            },
            user_id: id,
        } satisfies RelationshipAddEvent),
    ]);

    if (incoming_relationship.type === RelationshipType.FRIEND && outgoing_relationship.type === RelationshipType.FRIEND) {
        const [ownPresence, friendPresence, ownUser] = await Promise.all([getUserPresence(req.user_id), getUserPresence(id), User.getPublicUser(req.user_id)]);
        await Promise.all([
            emitEvent({ event: "PRESENCE_UPDATE", data: { user: friend.toPublicUser(), ...friendPresence }, user_id: req.user_id } satisfies PresenceUpdateEvent),
            emitEvent({ event: "PRESENCE_UPDATE", data: { user: ownUser, ...ownPresence }, user_id: id } satisfies PresenceUpdateEvent),
        ]);
    }

    return res.sendStatus(204);
}

export default router;
