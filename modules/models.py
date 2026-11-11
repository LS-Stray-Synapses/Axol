from pydantic import BaseModel

class ModelConfig(BaseModel):
    base_url: str
    api_key: str = "none"
    model: str
