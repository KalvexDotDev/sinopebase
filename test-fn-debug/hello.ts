export const config = { auth: false }
export default async function handler(req, ctx) { return { message: "hi", requestId: ctx.requestId } }