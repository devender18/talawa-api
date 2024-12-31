import {
	type SQL,
	and,
	asc,
	desc,
	eq,
	exists,
	gt,
	lt,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import {
	commentVotesTable,
	commentVotesTableInsertSchema,
} from "~/src/drizzle/tables/commentVotes";
import { User } from "~/src/graphql/types/User/User";
import {
	defaultGraphQLConnectionArgumentsSchema,
	transformDefaultGraphQLConnectionArguments,
	transformToDefaultGraphQLConnection,
} from "~/src/utilities/defaultGraphQLConnection";
import { TalawaGraphQLError } from "~/src/utilities/talawaGraphQLError";
import { Comment } from "./Comment";

const upVotersArgumentsSchema = defaultGraphQLConnectionArgumentsSchema
	.transform(transformDefaultGraphQLConnectionArguments)
	.transform((arg, ctx) => {
		let cursor: z.infer<typeof cursorSchema> | undefined = undefined;

		try {
			if (arg.cursor !== undefined) {
				cursor = cursorSchema.parse(
					JSON.parse(Buffer.from(arg.cursor, "base64url").toString("utf-8")),
				);
			}
		} catch (error) {
			ctx.addIssue({
				code: "custom",
				message: "Not a valid cursor.",
				path: [arg.isInversed ? "before" : "after"],
			});
		}

		return {
			cursor,
			isInversed: arg.isInversed,
			limit: arg.limit,
		};
	});

const cursorSchema = z.object({
	createdAt: commentVotesTableInsertSchema.shape.createdAt.unwrap(),
	creatorId: commentVotesTableInsertSchema.shape.creatorId.unwrap().unwrap(),
});

Comment.implement({
	fields: (t) => ({
		upVoters: t.connection(
			{
				description:
					"GraphQL connection to traverse through the voters that up voted the comment.",
				resolve: async (parent, args, ctx) => {
					const {
						data: parsedArgs,
						error,
						success,
					} = upVotersArgumentsSchema.safeParse(args);

					if (!success) {
						throw new TalawaGraphQLError({
							extensions: {
								code: "invalid_arguments",
								issues: error.issues.map((issue) => ({
									argumentPath: issue.path,
									message: issue.message,
								})),
							},
							message: "Invalid arguments provided.",
						});
					}

					const { cursor, isInversed, limit } = parsedArgs;

					const orderBy = isInversed
						? [
								asc(commentVotesTable.createdAt),
								asc(commentVotesTable.creatorId),
							]
						: [
								desc(commentVotesTable.createdAt),
								desc(commentVotesTable.creatorId),
							];

					let where: SQL | undefined;

					if (isInversed) {
						if (cursor !== undefined) {
							where = and(
								exists(
									ctx.drizzleClient
										.select()
										.from(commentVotesTable)
										.where(
											and(
												eq(commentVotesTable.createdAt, cursor.createdAt),
												eq(commentVotesTable.creatorId, cursor.creatorId),
												eq(commentVotesTable.commentId, parent.id),
												eq(commentVotesTable.type, "up_vote"),
											),
										),
								),
								eq(commentVotesTable.commentId, parent.id),
								eq(commentVotesTable.type, "up_vote"),
								or(
									and(
										eq(commentVotesTable.createdAt, cursor.createdAt),
										gt(commentVotesTable.creatorId, cursor.creatorId),
									),
									gt(commentVotesTable.createdAt, cursor.createdAt),
								),
							);
						} else {
							where = and(
								ne(commentVotesTable.creatorId, sql`${null}`),
								eq(commentVotesTable.commentId, parent.id),
								eq(commentVotesTable.type, "up_vote"),
							);
						}
					} else {
						if (cursor !== undefined) {
							where = and(
								exists(
									ctx.drizzleClient
										.select()
										.from(commentVotesTable)
										.where(
											and(
												eq(commentVotesTable.createdAt, cursor.createdAt),
												eq(commentVotesTable.creatorId, cursor.creatorId),
												eq(commentVotesTable.commentId, parent.id),
												eq(commentVotesTable.type, "up_vote"),
											),
										),
								),
								eq(commentVotesTable.commentId, parent.id),
								eq(commentVotesTable.type, "up_vote"),
								or(
									and(
										eq(commentVotesTable.createdAt, cursor.createdAt),
										lt(commentVotesTable.creatorId, cursor.creatorId),
									),
									lt(commentVotesTable.createdAt, cursor.createdAt),
								),
							);
						} else {
							where = and(
								ne(commentVotesTable.creatorId, sql`${null}`),
								eq(commentVotesTable.commentId, parent.id),
								eq(commentVotesTable.type, "up_vote"),
							);
						}
					}

					const commentVotes =
						await ctx.drizzleClient.query.commentVotesTable.findMany({
							columns: {
								createdAt: true,
								creatorId: true,
							},
							limit,
							orderBy,
							with: {
								creator: true,
							},
							where,
						});

					if (cursor !== undefined && commentVotes.length === 0) {
						throw new TalawaGraphQLError({
							extensions: {
								code: "arguments_associated_resources_not_found",
								issues: [
									{
										argumentPath: [isInversed ? "before" : "after"],
									},
								],
							},
							message:
								"No associated resources found for the provided arguments.",
						});
					}

					return transformToDefaultGraphQLConnection({
						createCursor: (vote) =>
							Buffer.from(
								JSON.stringify({
									createdAt: vote.createdAt,
									creatorId: vote.creatorId,
								}),
							).toString("base64url"),
						createNode: (vote) => vote.creator,
						parsedArgs,
						rawNodes: commentVotes.filter(
							(
								vote,
							): vote is typeof vote & {
								creator: NonNullable<(typeof vote)["creator"]>;
							} => vote.creator !== null,
						),
					});
				},
				type: User,
			},
			{
				description: "",
			},
			{
				description: "",
			},
		),
	}),
});