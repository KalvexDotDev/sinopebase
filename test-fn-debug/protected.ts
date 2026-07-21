export const config = { auth: true }
export default async function handler(req, ctx) { return { user: ctx.auth } }