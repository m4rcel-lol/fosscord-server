using System.Text.Json.Serialization;

namespace Spacebar.Cdn.Services;

public class SpacebarCdnWorkerConfiguration {
    public SpacebarCdnWorkerConfiguration(IConfiguration config) {
        config.GetRequiredSection("Spacebar").GetRequiredSection("Cdn").GetRequiredSection("Workers").Bind(this);
    }

    [JsonPropertyName("q8")]
    public List<string> Q8Workers { get; set; } = [];

    [JsonPropertyName("q16")]
    public List<string> Q16Workers { get; set; } = [];

    [JsonPropertyName("q16-hdri")]
    public List<string> Q16HdriWorkers { get; set; } = [];
}