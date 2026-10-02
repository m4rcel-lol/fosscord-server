using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Spacebar.Models.Generic;

[DebuggerDisplay("{User.Id} ({User.Username}#{User.Discriminator})")]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global")]
[SuppressMessage("ReSharper", "PropertyCanBeMadeInitOnly.Global")]
[JsonPolymorphic]
[JsonDerivedType(typeof(Member))]
[JsonDerivedType(typeof(MemberWithPresence))]
public class Member
{
    [JsonPropertyName("user")]
    public required PartialUser User { get; set; }

    [JsonPropertyName("nick")]
    public string? Nick { get; set; }

    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }

    [JsonPropertyName("avatar_decoration_data")]
    public JsonObject? AvatarDecorationData { get; set; }

    [JsonPropertyName("collectibles")]
    public JsonObject? Collectibles { get; set; }

    [JsonPropertyName("display_name_styles"), JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public DisplayNameStyle? DisplayNameStyles { get; set; }

    [JsonPropertyName("banner")]
    public string? Banner { get; set; }

    [JsonPropertyName("bio")]
    public string? Bio { get; set; }

    [JsonPropertyName("roles"), JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
    public List<long>? Roles { get; set; }
}

// Unsure if this is used anywhere outside of op14...?
public class MemberWithPresence : Member
{
    [JsonPropertyName("presence")]
    public Presence? Presence { get; set; }
}