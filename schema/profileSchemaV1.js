// What changed in Stage G
// schema/profileSchemaV1.js
module.exports = {
  $id: "ProfileSchemaV1",
  type: "object",
  required: ["profile", "experience", "education"],
  properties: {
    profile: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        headline: { type: "string" },
        currentRole: { type: "string" },
        currentCompany: { type: "string" },
        location: { type: "string" },
        about: { type: "string" },
        followersCount: { type: ["string", "number", "null"] },
        connectionsCount: { type: ["string", "number", "null"] },
        mutualConnections: { type: ["string", "number", "null"] }
      },
      additionalProperties: true
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          companyUrl: { type: "string" },
          duration: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          location: { type: "string" },
          description: { type: "string" }
        },
        additionalProperties: true
      }
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          school: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          startYear: { type: ["string","number"] },
          endYear: { type: ["string","number"] },
          duration: { type: "string" },
          grade: { type: "string" },
          activities: { type: "string" },
          description: { type: "string" }
        },
        additionalProperties: true
      }
    },
    awards: { type: "array", items: { type: "object" }, additionalProperties: true },
    certifications: { type: "array", items: { type: "object" }, additionalProperties: true },
    volunteer: { type: "array", items: { type: "object" }, additionalProperties: true },
    activity: { type: "array", items: { type: "object" }, additionalProperties: true },
    skills: { type: "array", items: { type: "string" } },
    engagement: { type: "object", additionalProperties: true }
  },
  additionalProperties: true
};
