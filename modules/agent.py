from ollama import AsyncClient
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
        client = AsyncClient(host=cfg.host)
        self.messages.append({"role": "user", "content": user_message})

        try:
            while True:
                thinking = ""
                content = ""
                tool_calls = []

                stream = await client.chat(
                    model= cfg.model, 
                    messages=self.messages, 
                    tools=self.all_tool_schemas(),
                    think=True,
                    stream=True
                )

                async for chunk in stream:
                    # Thinking
                    if chunk.message.thinking:
                        thinking += chunk.message.thinking
                        yield {"type": "thinking", "text": chunk.message.thinking}

                    # Answer
                    if chunk.message.content:
                        content += chunk.message.content
                        yield {"type": "text", "text": chunk.message.content}

                    # Tool Calls
                    if chunk.message.tool_calls:
                        tool_calls.extend(chunk.message.tool_calls)

                self.messages.append({"role": "assistant", "thinking": thinking, "content": content, "tool_calls": tool_calls})
                
                # No tools requested: finish
                if not tool_calls:
                    yield {"type": "done"}
                    return

                # Execute requested tools
                for call in tool_calls:
                    name = call.function.name or ""
                    args = call.function.arguments or {}

                    if isinstance(args, str):
                        args = json.loads(args)

                    call_id = str(uuid.uuid4())

                    yield {"type": "tool_call", "id": call_id, "name": name, "args": args}

                    try:
                        result = await self.call_tool(name, args)
                        is_error = False
                    except Exception as error:
                        result = str(error)
                        is_error = True

                    # Save result for Ollama   
                    self.messages.append(
                        {"role": "tool",  "tool_name": name, "content": str(result)}
                    )

                    # Send result to frontend
                    yield {"type": "tool_result", "id": call_id, "name": name, "result": str(result), "is_error": is_error}
        finally:
            await client.close()