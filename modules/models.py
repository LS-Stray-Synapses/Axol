from pydantic import BaseModel

class ModelConfig(BaseModel):
    host: str
    api_key: str = "none"
    model: str
