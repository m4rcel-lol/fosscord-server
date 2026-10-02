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

import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { EmailChange } from "@spacebar/api/util";
import { AvatarDecoration, User } from "@spacebar/database";
import { CollectibleItemType, Collectibles, Config, emitEvent, FieldErrors, generateToken, handleFile, UserUpdateEvent } from "@spacebar/util";
import { PrivateUserProjection, UserFlags, UserModifySchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "PrivateUser",
            },
        },
    }),
    async (req: Request, res: Response) => {
        res.json(
            await User.findOne({
                select: Object.fromEntries(PrivateUserProjection.map((i) => [i, true])), //TODO: cleanup
                where: { id: req.user_id },
            }),
        );
    },
);

router.patch(
    "/",
    route({
        requestBody: "UserModifySchema",
        responses: {
            200: {
                body: "UserUpdateResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as UserModifySchema;

        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: Object.fromEntries([...PrivateUserProjection, "data"].map((i) => [i, true])), //TODO: cleanup
        });

        let newToken: string | undefined;

        const checkPassword = async () => {
            if (!body.password)
                throw FieldErrors({
                    password: {
                        code: "PASSWORD_DOES_NOT_MATCH",
                        message: req.t("auth:login.INVALID_PASSWORD"),
                    },
                });
            if (user.data?.hash && !(await bcrypt.compare(body.password, user.data.hash)))
                throw FieldErrors({
                    password: {
                        code: "PASSWORD_DOES_NOT_MATCH",
                        message: req.t("auth:login.INVALID_PASSWORD"),
                    },
                });
        };

        if (body.avatar !== undefined) Object.assign(user, { avatar: body.avatar ? await handleFile(`/avatars/${req.user_id}`, body.avatar) : null });
        if (body.banner !== undefined) Object.assign(user, { banner: body.banner ? await handleFile(`/banners/${req.user_id}`, body.banner) : null });

        if (body.email && body.email !== user.email) {
            await checkPassword();
            if (body.email_token !== undefined && !EmailChange.consumeToken(req.user_id, body.email_token))
                throw FieldErrors({ email_token: { code: "INVALID_EMAIL_TOKEN", message: "Invalid email verification token" } });
            if (await User.findOne({ where: { email: body.email }, select: { id: true } }))
                throw FieldErrors({
                    email: {
                        code: "EMAIL_ALREADY_REGISTERED",
                        message: req.t("auth:register.EMAIL_ALREADY_REGISTERED"),
                    },
                });
            user.email = body.email;
        }

        if (body.new_password) {
            await checkPassword();
            user.data.hash = await bcrypt.hash(body.new_password, 12);
            user.data.valid_tokens_since = new Date();
            newToken = (await generateToken(user.id)) as string;
        }

        if (body.username && body.username !== user.username) {
            const username = body.username.trim();
            const { maxUsername } = Config.get().limits.user;
            if (username.replace(/\s/g, "").length < 2 || username.length > maxUsername)
                throw FieldErrors({
                    username: {
                        code: "BASE_TYPE_BAD_LENGTH",
                        message: `Must be between 2 and ${maxUsername} in length.`,
                    },
                });
            await checkPassword();

            if (await User.findOne({ where: { username, discriminator: body.discriminator || user.discriminator }, select: { id: true } })) {
                const discriminator = await User.generateDiscriminator(username);
                if (!discriminator)
                    throw FieldErrors({
                        username: {
                            code: "USERNAME_TOO_MANY_USERS",
                            message: req.t("auth:register.USERNAME_TOO_MANY_USERS"),
                        },
                    });
                user.discriminator = discriminator;
            }
            user.username = username;
        }

        if (body.discriminator && body.discriminator !== user.discriminator) {
            if (!/^\d{4}$/.test(body.discriminator)) {
                throw FieldErrors({
                    discriminator: {
                        code: "INVALID_DISCRIMINATOR",
                        message: "Discriminator must be 4 digits.",
                    },
                });
            }

            if (await User.findOne({ where: { discriminator: body.discriminator, username: user.username }, select: { id: true } })) {
                throw FieldErrors({
                    discriminator: {
                        code: "INVALID_DISCRIMINATOR",
                        message: "This discriminator is already in use.",
                    },
                });
            }
            user.discriminator = body.discriminator;
        }

        if (body.global_name !== undefined) {
            user.global_name = body.global_name?.trim() || null;
        }

        if (body.bio !== undefined) {
            const { maxBio } = Config.get().limits.user;
            if (body.bio.length > maxBio) {
                throw FieldErrors({
                    bio: {
                        code: "BIO_INVALID",
                        message: `Bio must be less than ${maxBio} in length`,
                    },
                });
            }
            user.bio = body.bio;
        }

        if (body.accent_color !== undefined) Object.assign(user, { accent_color: body.accent_color });

        if (body.flags !== undefined) {
            const mutable = Number(UserFlags.FLAGS.PREMIUM_PROMO_DISMISSED | UserFlags.FLAGS.HAS_UNREAD_URGENT_MESSAGES);
            user.flags = (Number(user.flags) & ~mutable) | (body.flags & mutable);
        }

        if (body.display_name_font_id !== undefined || body.display_name_effect_id !== undefined || body.display_name_colors !== undefined) {
            const font_id = body.display_name_font_id !== undefined ? body.display_name_font_id : user.display_name_styles?.font_id;
            const effect_id = body.display_name_effect_id !== undefined ? body.display_name_effect_id : user.display_name_styles?.effect_id;
            const colors = body.display_name_colors !== undefined ? body.display_name_colors : user.display_name_styles?.colors;
            Object.assign(user, {
                display_name_styles: font_id == null && effect_id == null && !colors?.length ? null : { font_id: font_id ?? 0, effect_id: effect_id ?? 0, colors: colors ?? [] },
            });
        }

        const decorationSku = body.avatar_decoration_sku_id !== undefined ? body.avatar_decoration_sku_id : body.avatar_decoration_id;
        if (decorationSku !== undefined) {
            Object.assign(user, { avatar_decoration_data: null, avatar_decoration_id: null });
            if (decorationSku) {
                const catalogItem = await Collectibles.item(decorationSku, CollectibleItemType.AVATAR_DECORATION);
                if (catalogItem?.asset) user.avatar_decoration_data = { asset: catalogItem.asset, sku_id: catalogItem.sku_id, expires_at: null };
                else {
                    const avatarDecoration = await AvatarDecoration.findOne({ where: { id: decorationSku } });
                    if (!avatarDecoration) throw FieldErrors({ avatar_decoration_sku_id: { code: "50057", message: "Invalid SKU" } });
                    if (!(await avatarDecoration.canUseAvatarDecoration(req.user_id)))
                        throw FieldErrors({ avatar_decoration_sku_id: { code: "40018", message: "You do not have access to this avatar decoration" } });
                    user.avatar_decoration_id = decorationSku;
                }
            }
        }

        if (body.nameplate_sku_id !== undefined) {
            if (!body.nameplate_sku_id) user.collectibles = { ...user.collectibles, nameplate: null };
            else {
                const nameplate = await Collectibles.item(body.nameplate_sku_id, CollectibleItemType.NAMEPLATE);
                if (!nameplate?.asset) throw FieldErrors({ nameplate_sku_id: { code: "50057", message: "Invalid SKU" } });
                user.collectibles = {
                    ...user.collectibles,
                    nameplate: { asset: nameplate.asset, sku_id: nameplate.sku_id, label: nameplate.label ?? "", palette: nameplate.palette ?? "", expires_at: null },
                };
            }
        }

        user.validate();
        await user.save();

        const updated = await User.findOneOrFail({
            where: { id: req.user_id },
            select: Object.fromEntries(PrivateUserProjection.map((i) => [i, true])),
            relations: { avatar_decoration: true },
        });
        const data = updated.toPrivateUser();

        await emitEvent({
            event: "USER_UPDATE",
            user_id: req.user_id,
            data: updated,
        } satisfies UserUpdateEvent);

        res.json(newToken ? { ...data, token: newToken } : data);
    },
);

export default router;
