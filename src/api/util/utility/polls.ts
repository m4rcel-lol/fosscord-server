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

import { sendMessage } from "@spacebar/api";
import { EmbedType, MessageReferenceType, MessageType, PollAnswerCount } from "@spacebar/schemas";
import { emitEvent, MessageUpdateEvent, pendingPolls } from "@spacebar/util";
import { Message } from "@spacebar/database";
import { MessageOptions } from "@spacebar/util/dtos/MessageOptions";

type StoredAnswerCount = Omit<PollAnswerCount, "me_voted" | "id"> & { id: number | string; voters: string[] };

export function generatePollResultsMessage(message: Message): MessageOptions {
    if (!message.poll) return {};

    const counts = (message.poll.results?.answer_counts ?? []) as unknown as StoredAnswerCount[];
    const totalVotes = counts.reduce((sum, answer) => sum + answer.count, 0);
    const best = Math.max(0, ...counts.map((answer) => answer.count));
    const winners = best > 0 ? counts.filter((answer) => answer.count === best) : [];

    const fields = [
        { name: "poll_question_text", value: message.poll.question.text ?? "" },
        { name: "victor_answer_votes", value: `${best}` },
        { name: "total_votes", value: `${totalVotes}` },
    ];

    if (winners.length === 1) {
        const winner = message.poll.answers.find((answer) => Number(answer.answer_id) === Number(winners[0].id));
        fields.push({ name: "victor_answer_id", value: `${winners[0].id}` });
        if (winner?.poll_media.text) fields.push({ name: "victor_answer_text", value: winner.poll_media.text });
        const emoji = winner?.poll_media.emoji;
        if (emoji) {
            if (emoji.id) fields.push({ name: "victor_answer_emoji_id", value: `${emoji.id}` });
            if (emoji.name) fields.push({ name: "victor_answer_emoji_name", value: emoji.name });
            fields.push({ name: "victor_answer_emoji_animated", value: `${!!emoji.animated}` });
        }
    }

    return {
        type: MessageType.POLL_RESULT,
        channel_id: message.channel_id,
        author_id: message.author_id,
        message_reference: {
            type: MessageReferenceType.DEFAULT,
            message_id: message.id,
            channel_id: message.channel_id,
            guild_id: message.guild_id,
        },
        embeds: [{ type: EmbedType.poll_result, fields }],
    };
}

export async function finalizePoll(messageId: string) {
    pendingPolls.delete(messageId);
    const message = await Message.findOne({ where: { id: messageId }, relations: { author: true } });
    if (!message?.poll || message.poll.results?.is_finalized) return message;

    message.poll.results = { answer_counts: [], ...message.poll.results, is_finalized: true };
    if (new Date(message.poll.expiry) > new Date()) message.poll.expiry = new Date();
    await Message.update({ id: message.id, channel_id: message.channel_id }, { poll: message.poll });

    await emitEvent({
        event: "MESSAGE_UPDATE",
        channel_id: message.channel_id,
        data: message.toJSON(),
    } satisfies MessageUpdateEvent);

    await sendMessage(generatePollResultsMessage(message));
    return message;
}

export async function addPendingPoll(message: Message, timeoutTime: number) {
    pendingPolls.set(message.id, {
        timeout: setTimeout(() => finalizePoll(message.id).catch((e) => console.error("[Polls] failed to finalize poll", e)), Math.min(Math.max(timeoutTime, 0), 2 ** 31 - 1)),
    });
}
