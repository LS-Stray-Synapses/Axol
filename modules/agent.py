from openai import AsyncOpenAI
import json
import uuid
import inspect

class Agent():
    def __init__(self, local_tools, mcp_tools, model_name: str, models: dict, messages: list[dict] | None = None):
        self.local_tools = local_tools
        self.mcp_tools = mcp_tools
        self.model_name = model_name
        self.models = models
        self.messages = messages if messages is not None else []

    def  all_tool_schemas(self) -> list[dict]:
        return self.local_tools.tool_schemas() + self.mcp_tools.schemas()

    async def call_tool(self, name: str, args: dict) -> str:
        local_registry = self.local_tools.tool_registry()
        if name in local_registry:
            result = local_registry[name](**args)

            if inspect.isawaitable(result):
                result = await result
                
            return str(result)
        if name in self.mcp_tools.sessions:
            result = await  self.mcp_tools.sessions[name].call_tool(name, args)
            return "\n".join(c.text for c in result.content if hasattr(c, "text"))
        return f"error: unknown tool {name}"

    async def run_agent(self, user_message: str):
        cfg = self.models[self.model_name]
        client = AsyncOpenAI(base_url=cfg.host, api_key=cfg.api_key)
        self.messages.append({"role": "user", "content": user_message})

        try:
            while True:
                thinking = ""
                content = ""
                tool_calls = {}

                stream = await client.chat.completions.create(
                    model=cfg.model,
                    messages=self.messages,
                    tools=self.all_tool_schemas(),
                    stream=True,
                    reasoning_effort="xhigh"
                )

                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    # Thinking
                    reasoning = (getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None))
                    if reasoning:
                        thinking += reasoning
                        yield {"type": "thinking", "text": reasoning}
                    # Answer
                    if delta.content:
                        content += delta.content
                        yield {"type": "text", "text": delta.content}
                    # Tool Calls
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            index = tc.index
                            if index not in tool_calls:
                                tool_calls[index] = {
                                    "id": "",
                                    "name": "",
                                    "arguments": ""
                                }
                            if tc.id:
                                tool_calls[index]["id"] = tc.id
                            if tc.function.name:
                                tool_calls[index]["name"] += tc.function.name
                            if tc.function.arguments:
                                tool_calls[index]["arguments"] += tc.function.arguments

                # Reconstruct complete tool calls
                tool_calls = [tool_calls[i] for i in sorted(tool_calls)]

                # Save assistant message in OpenAI format
                assistant_message = {"role": "assistant", "content": content or None}
                if tool_calls:
                    assistant_message["tool_calls"] = [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": call["arguments"]
                            }
                        }
                        for call in tool_calls
                    ]

                self.messages.append(assistant_message)

                # No tools requested: finish
                if not tool_calls:
                    yield {"type": "done"}
                    return

                # Execute requested tools
                for call in tool_calls:
                    name = call["name"]
                    args = json.loads(call["arguments"] or "{}")
                    model_call_id = call["id"]
                    frontend_id = str(uuid.uuid4())

                    yield {"type": "tool_call", "id": frontend_id, "name": name, "args": args}

                    try:
                        result = await self.call_tool(name, args)
                        is_error = False
                    except Exception as error:
                        result = str(error)
                        is_error = True

                    # Save result for llama.cpp (OpenAI format)
                    self.messages.append({"role": "tool", "tool_call_id": model_call_id, "content": str(result)})

                    # Send result to frontend
                    yield {"type": "tool_result", "id": frontend_id, "name": name, "result": str(result), "is_error": is_error}

        finally:
            await client.close()