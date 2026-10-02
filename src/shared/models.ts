// What a model needs to hold a conversation with Jezo's agent
// (docs/design/backend.md, "Models").

/** Whether a model's context is too small for the agent, given the tokens a conversation needs (ModelChoices.agentContext). */
export const tooSmallForAgent = (contextWindow: number | undefined, needed: number) => !!contextWindow && contextWindow < needed
