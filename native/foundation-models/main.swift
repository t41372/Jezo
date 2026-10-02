import Foundation
import CoreFoundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// One request per process. Only protocol records go to stdout; no tool runs here.
func emit(_ record: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    try FileHandle.standardOutput.write(contentsOf: data + Data([10]))
}

struct BridgeError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
struct Handoff: Error {
    let name: String
    let arguments: String
}

@available(macOS 26.0, *)
struct DeferredTool: Tool {
    let name: String
    let description: String
    let parameters: GenerationSchema

    func call(arguments: GeneratedContent) async throws -> String {
        // Throwing stops Apple's tool loop. pi owns validation, execution and undo.
        throw Handoff(name: name, arguments: arguments.jsonString)
    }
}

// Explicitly supported JSON Schema subset. Unknown validation keywords fail;
// accepting them and dropping their meaning would change the tool's contract.
@available(macOS 26.0, *)
func schema(_ value: [String: Any], name: String) throws -> DynamicGenerationSchema {
    let annotations: Set<String> = ["description", "title", "$schema"]
    let shape: Set<String>
    if value["enum"] != nil { shape = ["type", "enum"] }
    else if value["const"] != nil { shape = ["type", "const"] }
    else if value["anyOf"] != nil { shape = ["anyOf"] }
    else {
        switch value["type"] as? String {
        case "object": shape = ["type", "properties", "required", "additionalProperties"]
        case "array": shape = ["type", "items", "minItems", "maxItems"]
        case "integer", "number": shape = ["type", "minimum", "maximum"]
        default: shape = ["type"]
        }
    }
    let unsupported = Set(value.keys).subtracting(annotations.union(shape))
    guard unsupported.isEmpty else {
        throw BridgeError(message: "Apple Foundation Models cannot represent \(name): \(unsupported.sorted().joined(separator: ", ")).")
    }
    if value["enum"] != nil || value["const"] != nil {
        if let type = value["type"] as? String, type != "string" {
            throw BridgeError(message: "Apple Foundation Models requires string enums in \(name).")
        }
    }
    if let choices = value["enum"] as? [String], !choices.isEmpty {
        return DynamicGenerationSchema(name: name, anyOf: choices)
    }
    if let constant = value["const"] as? String {
        return DynamicGenerationSchema(name: name, anyOf: [constant])
    }
    if value["enum"] != nil || value["const"] != nil {
        throw BridgeError(message: "Apple Foundation Models requires string enum values in \(name).")
    }
    if let choices = value["anyOf"] as? [[String: Any]], !choices.isEmpty {
        return try DynamicGenerationSchema(name: name, anyOf: choices.enumerated().map { index, choice in
            try schema(choice, name: "\(name)_\(index)")
        })
    }
    switch value["type"] as? String {
    case "object":
        if let additional = value["additionalProperties"], !(additional is Bool && additional as? Bool == false) {
            throw BridgeError(message: "Apple Foundation Models requires named properties in \(name).")
        }
        guard value["required"] == nil || value["required"] is [String],
              value["properties"] == nil || value["properties"] is [String: [String: Any]] else {
            throw BridgeError(message: "Invalid object properties or required fields in \(name).")
        }
        let required = Set(value["required"] as? [String] ?? [])
        let properties = value["properties"] as? [String: [String: Any]] ?? [:]
        guard required.isSubset(of: Set(properties.keys)) else {
            throw BridgeError(message: "Required fields must have named properties in \(name).")
        }
        return try DynamicGenerationSchema(name: name, description: value["description"] as? String, properties: properties.keys.sorted().map { key in
            let property = properties[key]!
            return try DynamicGenerationSchema.Property(name: key, description: property["description"] as? String,
                schema: schema(property, name: "\(name)_\(key)"), isOptional: !required.contains(key))
        })
    case "array":
        guard let item = value["items"] as? [String: Any] else { throw BridgeError(message: "Missing items schema in \(name).") }
        let minimum = try itemCount(value, key: "minItems", name: name)
        let maximum = try itemCount(value, key: "maxItems", name: name)
        if let minimum, let maximum, minimum > maximum {
            throw BridgeError(message: "minItems exceeds maxItems in \(name).")
        }
        return try DynamicGenerationSchema(
            arrayOf: schema(item, name: "\(name)_item"),
            minimumElements: minimum, maximumElements: maximum
        )
    case "string": return DynamicGenerationSchema(type: String.self)
    case "integer":
        var guides: [GenerationGuide<Int>] = []
        if let minimum = try numericBound(value, key: "minimum", name: name) {
            guard let bound = Int(exactly: minimum.rounded(.up)) else {
                throw BridgeError(message: "Integer minimum is out of range in \(name).")
            }
            guides.append(.minimum(bound))
        }
        if let maximum = try numericBound(value, key: "maximum", name: name) {
            guard let bound = Int(exactly: maximum.rounded(.down)) else {
                throw BridgeError(message: "Integer maximum is out of range in \(name).")
            }
            guides.append(.maximum(bound))
        }
        return DynamicGenerationSchema(type: Int.self, guides: guides)
    case "number":
        var guides: [GenerationGuide<Double>] = []
        if let minimum = try numericBound(value, key: "minimum", name: name) { guides.append(.minimum(minimum)) }
        if let maximum = try numericBound(value, key: "maximum", name: name) { guides.append(.maximum(maximum)) }
        return DynamicGenerationSchema(type: Double.self, guides: guides)
    case "boolean": return DynamicGenerationSchema(type: Bool.self)
    default: throw BridgeError(message: "Apple Foundation Models cannot represent the schema for \(name).")
    }
}

// JSON booleans bridge to NSNumber too; they are not numeric schema bounds.
func numericBound(_ value: [String: Any], key: String, name: String) throws -> Double? {
    guard let raw = value[key] else { return nil }
    guard let number = raw as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else {
        throw BridgeError(message: "Invalid \(key) in \(name): expected a finite number.")
    }
    return number.doubleValue
}

func itemCount(_ value: [String: Any], key: String, name: String) throws -> Int? {
    guard let number = try numericBound(value, key: key, name: name) else { return nil }
    guard let count = Int(exactly: number), count >= 0 else {
        throw BridgeError(message: "Invalid \(key) in \(name): expected a non-negative integer.")
    }
    return count
}

struct Request: Decodable {
    let version: Int
    let instructions: String
    let tools: [ToolInput]
    let messages: [MessageInput]
    let maxTokens: Int
    let temperature: Double?

    struct ToolInput: Decodable {
        let name: String
        let description: String
        let schema: String
    }
    struct MessageInput: Decodable {
        let role: String
        let text: String
        let calls: [CallInput]?
        let id: String?
        let name: String?
    }
    struct CallInput: Decodable {
        let id: String
        let name: String
        let arguments: String
    }
}

@available(macOS 26.0, *)
func unavailableReason(_ model: SystemLanguageModel) -> String? {
    switch model.availability {
    case .available: return nil
    case .unavailable(.deviceNotEligible): return "device-not-eligible"
    case .unavailable(.appleIntelligenceNotEnabled): return "intelligence-disabled"
    case .unavailable(.modelNotReady): return "model-not-ready"
    case .unavailable: return "unavailable"
    }
}

@available(macOS 26.0, *)
func generate(_ request: Request, model: SystemLanguageModel) async throws {
    guard request.version == 1 else { throw BridgeError(message: "Unsupported Foundation Models bridge version.") }
    guard request.maxTokens > 0 else { throw BridgeError(message: "maxTokens must be positive.") }
    let tools = try request.tools.map { input in
        guard let object = try JSONSerialization.jsonObject(with: Data(input.schema.utf8)) as? [String: Any] else {
            throw BridgeError(message: "Invalid schema for \(input.name).")
        }
        return try DeferredTool(name: input.name, description: input.description,
            parameters: GenerationSchema(root: schema(object, name: input.name), dependencies: []))
    }
    func text(_ value: String) -> [Transcript.Segment] { [.text(.init(content: value))] }
    var entries: [Transcript.Entry] = [.instructions(.init(segments: text(request.instructions), toolDefinitions: tools.map {
        .init(name: $0.name, description: $0.description, parameters: $0.parameters)
    }))]
    for message in request.messages {
        switch message.role {
        case "user": entries.append(.prompt(.init(segments: text(message.text))))
        case "assistant":
            if !message.text.isEmpty { entries.append(.response(.init(assetIDs: [], segments: text(message.text)))) }
            if let calls = message.calls, !calls.isEmpty {
                entries.append(.toolCalls(.init(try calls.map {
                    try Transcript.ToolCall(id: $0.id, toolName: $0.name, arguments: GeneratedContent(json: $0.arguments))
                })))
            }
        case "tool":
            guard let id = message.id, let name = message.name else { throw BridgeError(message: "Tool output is missing its call ID or name.") }
            entries.append(.toolOutput(.init(id: id, toolName: name, segments: text(message.text))))
        default: throw BridgeError(message: "Unknown message role: \(message.role).")
        }
    }
    // respond adds a prompt. Move the final user turn into it; after tool output
    // an empty prompt asks the framework to continue the reconstructed transcript.
    var prompt = ""
    if case .prompt = entries.last {
        prompt = request.messages.last?.text ?? ""
        entries.removeLast()
    }
    let inputEntries = entries + [.prompt(.init(segments: text(prompt)))]
    var inputTokens = Int(ceil(Double(request.instructions.count + request.messages.reduce(0) { $0 + $1.text.count } + request.tools.reduce(0) { $0 + $1.schema.count }) / 3))
    if #available(macOS 26.4, *) { inputTokens = try await model.tokenCount(for: inputEntries) }
    guard inputTokens < model.contextSize else {
        throw BridgeError(message: "Input exceeds the context window: \(inputTokens) tokens, limit \(model.contextSize). Start a shorter conversation or choose a model with more context.")
    }
    try emit(["type": "usage", "input": inputTokens])
    let session = LanguageModelSession(model: model, tools: tools, transcript: Transcript(entries: entries))
    let budget = min(request.maxTokens, max(1, model.contextSize - inputTokens))
    let options = GenerationOptions(temperature: request.temperature, maximumResponseTokens: budget)
    var output = ""
    do {
        for try await snapshot in session.streamResponse(to: prompt, options: options) {
            output = snapshot.content
            try emit(["type": "text", "text": output])
        }
        var outputTokens = Int(ceil(Double(output.count) / 3))
        if #available(macOS 26.4, *) { outputTokens = try await model.tokenCount(for: output) }
        // The framework's older stream API has no finish reason. Conservatively
        // report a reached output budget as length, never as a completed action.
        try emit(["type": "done", "reason": outputTokens >= budget ? "length" : "stop", "output": outputTokens])
    } catch let error as LanguageModelSession.ToolCallError {
        guard let call = error.underlyingError as? Handoff else { throw error }
        try emit(["type": "tool", "id": UUID().uuidString, "name": call.name, "arguments": call.arguments])
        var outputTokens = Int(ceil(Double(output.count + call.arguments.count + call.name.count) / 3))
        if #available(macOS 26.4, *) { outputTokens = try await model.tokenCount(for: output + call.name + call.arguments) }
        try emit(["type": "done", "reason": "toolUse", "output": outputTokens])
    }
}
#endif

@main struct FoundationModelsBridge {
    static func main() async {
        do {
            #if canImport(FoundationModels)
            if #available(macOS 26.0, *) {
                let model = SystemLanguageModel.default
                if CommandLine.arguments.contains("--availability") {
                    try emit(["version": 1, "reason": unavailableReason(model) ?? "available", "contextWindow": model.contextSize])
                    return
                }
                if let reason = unavailableReason(model) { throw BridgeError(message: "Apple Foundation Models is unavailable: \(reason).") }
                let request = try JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile())
                try await generate(request, model: model)
                return
            }
            #endif
            try emit(["version": 1, "reason": "unsupported-system"])
        } catch {
            // Swift's top-level throwing main traps on errors; report a protocol error instead.
            try? emit(["type": "error", "message": error.localizedDescription])
        }
    }
}
