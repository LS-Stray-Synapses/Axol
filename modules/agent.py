from openai import AsyncOpenAI
import json

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
            return local_registry[name](**args)
        if name in self.mcp_tools.sessions:
            result = await  self.mcp_tools.sessions[name].call_tool(name, args)
            return "\n".join(c.text for c in result.content if hasattr(c, "text"))
        return f"error: unknown tool {name}"

    async def run_agent(self, user_message: str) -> str:
        cfg = self.models[self.model_name]
        client = AsyncOpenAI(base_url=cfg.base_url, api_key=cfg.api_key)

        self.messages.append({"role": "user", "content": user_message})
        while True:
            response = await client.chat.completions.create(
                model= cfg.model, messages=self.messages, tools=self.all_tool_schemas()
            )
            message = response.choices[0].message or ""
            if not message.tool_calls:
                self.messages.append({"role": "assistant", "content": message.content})
                return message.content
        
            self.messages.append(message)
            for call in message.tool_calls:
                args = json.loads(call.function.arguments or "{}")
                print(f"   [tool]{call.function.name}({args})")
                result = await self.call_tool(call.function.name, args)
                self.messages.append(
                    {"role": "tool", "tool_call_id": call.id, "content": result}
                )
                
    def handle_commands(self, line: str) -> bool:
        if not line.startswith("/"):
            return False
        cmd, _, arg =line.partition(" ")
        if cmd =="/models":
            for name, cfg in self.models.items():
                marker = "*" if name == self.model_name else " "
                print(f" {marker} {name:<12} {cfg.model}  ({cfg.base_url})")
        elif cmd == "/model":
            if arg in self.models:
                self.model_name = arg
                print(f"   switched to {arg} ({self.models[arg].model})")
            else:
                print(f"   unknown model '{arg}' - try /models")
        elif cmd == "/tools":
            for schema in self.all_tool_schemas():
                fn = schema["function"]
                origin = "local" if fn["name"] in self.local_tools.tool_schemas() else "mcp"
                print(f"   [{origin}] {fn['name']}: ({fn['description'][:60]})")
        elif cmd =="/memory":
            print(self.local_tools.load_memory())
        elif cmd =="/quit":
            raise SystemExit
        else:
            print(f"   commands: /models /model <name> /tools /memory /quit")
        return True