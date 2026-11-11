from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import json
from contextlib import AsyncExitStack
from pathlib import Path

class MCPTools():
    def __init__(self, config_path:Path):
        self.config_path = config_path
        self.sessions: dict[str, ClientSession] = {}
        self.tool_schemas: list[dict] = []

    async def connect_mcp(self, stack: AsyncExitStack):
        config = json.loads(self.config_path.read_text(encoding="utf-8"))
        for name, spec in config["mcpServers"].items():
            params = StdioServerParameters(command=spec["command"], args=spec["args"])
            try:
                read, write = await stack.enter_async_context(stdio_client(params))
                session = await stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
            except Exception as e:
                print(f"   [mcp] '{name}' failed to start: {e}")
                continue

            tools = (await session.list_tools()).tools
            for tool in tools:
                if tool.name in self.sessions:
                    print(f"   [mcp] duplicate tool skipped: {tool.name}")
                    continue
                self.sessions[tool.name] = session
                self.tool_schemas.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema
                        }
                    }
                )
            print(f"   [mcp] connected '{name}': {[t.name for t in tools]}")

    def schemas(self) -> list[dict]:
        return self.tool_schemas
            