// The worker and settings probe share the exact DSH provider declaration.
export function modelRoute(model) {
  return {
    [model.provider ?? "project"]: {
      baseURL: model.base_url,
      api: model.api,
      apiKeyEnv: "ORCHMESH_TASK_MODEL_KEY",
      models: [{
        id: model.id,
        ...(model.compat ? { compat: model.compat } : {}),
        ...(model.efforts !== undefined && model.efforts !== null
          ? { reasoningEfforts: model.efforts } : {}),
      }],
    },
  };
}
