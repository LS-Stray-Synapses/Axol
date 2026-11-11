from pathlib import Path
import os

class LocalTools():
    def __init__(self, workspace:Path, memory_file:Path):
        self.workspace = workspace
        self.memory_file = memory_file

    def load_memory(self) -> str:
        if self.memory_file.is_file():
            return self.memory_file.read_text(encoding="utf-8")
        return "(nothing saved yet)"
    
    def save_memory(self, fact: str) -> str:
        with self.memory_file.open("a", encoding="utf-8") as f:
            f.write(f"- {fact}\n")
        return f"saved: {fact}"
    
    def list_files(self) -> str:
        return "\n".join(p.name for p in self.workspace.iterdir()) or "(empty)"

    def read_file(self, filename: str) -> str:
        path = self.workspace / filename
        if not path.is_file():
            return f"error: no file named {filename}"
        return path.read_text(encoding="utf-8")

    def write_file(self, filename: str, content: str) -> str:
        path = self.workspace / filename
        path.write_text(content, encoding="utf-8")
        return f"wrote {filename}"
    
    def delete_file(self, filename: str) -> str:
        if os.path.exists(self.workspace / filename):
            os.remove(self.workspace / filename)
        return f"delete {filename}"

    def tool_registry(self) -> dict[str, object]:
        return {
            "list_files": self.list_files,
            "read_file": self.read_file, 
            "write_file": self.write_file,
            "delete_file": self.delete_file,
            "save_memory": self.save_memory
        }
    def tool_schemas(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "list_files",
                    "description": "List the files in the user's workspace folder",
                    "parameters": {"type": "object", "properties": {}}
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read one file from the user's workspace folder.",
                    "parameters": {
                        "type": "object",
                        "properties": {"filename": {"type": "string"}},
                        "required": ["filename"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "write_file",
                    "description": "Write a file in the user's workspace folder.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "filename": {"type": "string"},
                            "content": {"type": "string"}
                        },
                        "required": ["filename", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_file",
                    "description": "Delete a file in the user's workspace folder.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "filename": {"type": "string"}
                        },
                        "required": ["filename"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "save_memory",
                    "description": (
                        "Save one short fact about the user to long-term memory. "
                        "Use whenever you learn something worth remembering: their"
                        "name, preferences, projects, recurring tasks."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {"fact": {"type": "string"}},
                        "required": ["fact"]
                    }
                }
            }
        ]