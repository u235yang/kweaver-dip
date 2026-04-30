# KWeaver DIP 0.6.0 Release Notes

KWeaver DIP 0.6.0 continues to deepen the platform's core capabilities, with major upgrades focused on three directions: **Digital Employee stability and security enhancements, intelligent Business Knowledge Network construction, and expanded Data Analyst capabilities**. Building on 0.5.0, this release strengthens digital employee execution security, cross-origin API access, and Lark proactive message push; upgrades BKN Creator's relationship mapping and quality assessment framework; and introduces key new capabilities for the Data Analyst—including report generation, permission control, and chart visualization—helping enterprises integrate Digital employees into real business scenarios with lower barriers and higher reliability.

## Highlights

1. **DIP Studio**: Added cross-origin API access and Lark proactive message push capabilities; completed system initialization flow optimization; fixed multiple stability issues—significantly improving platform reliability and enterprise system integration.
2. **BKN Creator**: Fully refactored the relationship mapping architecture to support intelligent identification and automatic binding recommendations for both direct and intermediate view relationship types; introduced an independent Validate Pipeline for multi-dimensional quantitative assessment of Business Knowledge Network quality; Domain Knowledge is now self-contained, supporting independent community contributions.
3. **Data Analyst**: Added core capabilities including dimensional attribution analysis, automatic report generation and download, end-to-end data permission request-and-approval workflow, chart display and switching, and Todolist task management; built-in Data Analyst templates help organizations deploy data service capabilities in shorter cycles.
4. **Execution Factory**: Added a Skill management page with built-in Data Analyst and data understanding toolboxes, reducing skill management overhead and tool integration complexity.

---

## DIP Studio

DIP Studio is an enterprise-grade platform for creating and managing Digital Employees, supporting continuous construction and optimization. In 0.6.0, the focus is on improving platform security, stability, and system integration—adding cross-origin Digital Employee API access and Lark proactive push capabilities, fixing multiple known issues, and providing a more reliable and flexible operating environment for Digital Employees.

### 1. Cross-Origin API Access for Digital Employees

Digital Employee APIs can now be called cross-origin from third-party platforms, enabling task initiation and execution. Enterprises can seamlessly embed Digital Employee capabilities into existing business systems or portals—triggering Digital Employees to complete business tasks without switching platforms—breaking down the integration barrier between Digital Employees and existing enterprise systems.

### 2. Lark Proactive Message Push

Digital Employees can now proactively push task result messages to Lark users upon task completion, upgrading from passive response to proactive notification. Users no longer need to wait on the platform; task results are automatically delivered to Lark, reducing context-switching wait time and improving end-to-end task closure efficiency.

### 3. System Initialization Flow Optimization

The overall platform initialization process has been optimized to improve stability and consistency during first-time startup and configuration, reducing the risk of service interruptions caused by initialization errors and lowering operational intervention costs during platform deployment and startup.

### 4. Internal Environment Variable Leak Risk Fix

Fixed an issue where regular users could potentially retrieve backend internal environment variables through responses, error messages, or tool call results while using Digital employees. Sensitive field filtering and desensitization policies have been applied to all user-visible outputs, and the runtime context accessible to regular users has been restricted—ensuring that internal configuration details such as service addresses, access credentials, and tokens are not exposed, maintaining platform security and compliance.

### 5. Bug Fixes

- Fixed an issue where intermittent frontend network errors during streaming output caused task interruptions.
- Fixed an issue where archived skill download links were generated incorrectly, preventing normal file downloads.
- Fixed an occasional issue where Digital Employees would not respond to user queries.
- Fixed an issue where excessively long first-round session messages caused API errors.
- Fixed an issue where calling the create Digital Employee API successfully caused the OpenClaw service to stop unexpectedly and fail to restart automatically.
- Fixed an issue where archived skill information was redundantly displayed on the history page.
- Fixed an issue where channel configuration records disappeared and channel access failed after an admin refreshed the page post-configuration.
- Fixed incorrect error codes and abnormal prompt returns in scenarios where scheduled executions produced no results.
- Fixed incorrect display of work plan execution conditions (execution conditions were not correctly shown based on the schedule).
- Fixed an issue where historical conversation data was not properly cleaned up after a Digital Employee was deleted, leaving long-term residual data.

---

## BKN Creator

BKN Creator is responsible for building and managing the Business Knowledge Network. In 0.6.0, the relationship mapping architecture has been fully refactored, an independent check and quality assessment pipeline has been introduced, and Domain Knowledge has been made self-contained—further improving the intelligence and extensibility of Business Knowledge Network construction.

### 1. Self-Contained Domain Knowledge with Community Extension Support

Domain knowledge packages have been internalized from external dependencies, decoupling them from KWeaver Core. Domain extensions can now evolve entirely independently without affecting the core Pipeline, significantly improving maintainability and accelerating iteration. Community users can submit domain knowledge packages directly without needing to understand the full platform architecture, greatly lowering the contribution barrier and accelerating the accumulation and expansion of industry-specific knowledge bases.

### 2. New Validate Pipeline for Enhanced Business Knowledge Network Quality Assessment

An independent BKN quality diagnostics and risk assessment Pipeline has been introduced, supporting BKN quality diagnostics and risk evaluation. It can be triggered independently via a dedicated diagnostics entry point, separate from the create/update process, enabling rapid problem identification.

The quality scoring system evaluates the Business Knowledge Network across three dimensions: **schema compliance, binding completeness, and mapping coverage**. The system automatically categorizes issue types (knowledge gaps / semantic deviations / missing bindings) and matches them to corresponding remediation paths. Degraded checks are also supported when plugins are unavailable, ensuring a baseline quality floor—helping enterprises continuously optimize Business Knowledge Network quality in a more reliable manner.

### 3. Relationship Mapping Architecture Refactoring — New Relationship Type Detection and Intermediate View Binding

Relationship binding has been split from a single process into independent stages, supporting automatic identification of two relationship modes: `direct` (direct foreign key) and `data_view` (requiring an intermediate view). For `data_view` type relationships, the system automatically recommends candidate intermediate views and guides users through binding confirmation. Relationships with incomplete bindings do not block the overall process and can be supplemented later.

Pipeline stages have been refined: the Create flow has been expanded from 7 stages to 9 stages, with Stage 5 (Relationship Binding) and Stage 6 (Attribute Mapping + Backfill) now independently separated for clearer logic. The Feedback/Update flow has been updated in sync, adding the `relation_binding_issue` type to support targeted remediation of relationship binding problems—significantly improving the accuracy and maintainability of complex business relationship modeling.

---

## Data Analyst

The Data Analyst is a Digital Employee built on the organization's universal Knowledge Network and Domain Knowledge Network, with capabilities for data discovery and data querying. In 0.6.0, multiple functional improvements have been made across Data Analyst creation, analysis result presentation, permission control, and task planning—including new report generation, dimensional attribution, chart visualization, and data permission management capabilities—helping business teams quickly acquire business-specific Data Analysts with lower barriers.

### 1. Data Discovery / Data Query / Data Interpretation Reports

New report skills have been added covering data querying, data discovery, and data interpretation scenarios. In data querying scenarios, reports can be automatically generated with content fully presenting the data analysis process and conclusions. Reports support online preview or download locally in `.md` / `.html` format, enabling analysis conclusions to be retained, reused, shared, and archived.

### 2. Dimensional Attribution Reports

New dimensional attribution analysis capability has been added, supporting automatic dimensional decomposition and attribution analysis of metric fluctuations. Analysis reports are automatically stored and available for download. This helps business users quickly identify the driving factors behind metric anomalies, reducing the time and judgment bias associated with manual attribution analysis.

### 3. Built-in Data Analyst Templates

The platform now includes built-in Data Analyst (Digital Employee) templates. Users can enable a complete data discovery and querying service out of the box without starting from scratch—significantly lowering the configuration threshold and helping enterprises quickly deploy data service capabilities into real business scenarios.

### 4. End-to-End Data Permission Request and Approval Workflow

Data view permission verification has been added to the data discovery and querying skills. When a user lacks access permissions, a data permission request process is automatically triggered with a built-in approval workflow. Upon approval, the corresponding view permission is automatically granted to the user—completing the full lifecycle of permission request and authorization, ensuring data security and compliance while improving user efficiency in accessing data.

### 5. Chart Display and Switching

Analysis results can now be displayed in chart form, with support for switching between multiple chart types: table, bar chart, line chart, pie chart, and donut chart. Users can flexibly select the most appropriate visualization based on their analysis scenario, improving data insight clarity and lowering the barrier for business users to understand data.

### 6. Task Planning Todolist Display

A new Todolist display module has been added for task planning, visually presenting pending task lists and execution progress on the page. This helps users clearly track current data analysis tasks, improves task management efficiency in multi-task scenarios, and prevents task omissions and progress confusion.

### 7. Metric Query Skills Integration

Metric query Skills integration with OpenClaw (integrated in 0.6.0, officially released in 0.7.0) has been completed. Metric query Skills cover grouped dimensions, time-dimension queries, and multiple analysis modes including instant, trend, period-over-period, and proportion. Aggregation methods such as count, sum, average, max, and min are also supported. This release completes the capability integration and validation, ensuring stable operation across all metric query stages and providing the foundation for the official 0.7.0 release.

### 8. Bug Fixes

- Fixed an issue in the field disambiguation feature where associated data tables for fields with identical Chinese meanings were not displayed.
- Fixed an issue where disambiguation guidance was not triggered when time field ambiguity was detected.
- Fixed an issue where the workflow auto-authorization API returned incorrect permission errors and did not return the correct response.

---

## Execution Factory

### 1. New Skill Management Page in Execution Factory

A Skill management page has been added to the Execution Factory, supporting Skill import and unified management—improving skill configuration visibility and manageability, and reducing management overhead.

### 2. Built-in Data Analyst and Data Understanding Toolboxes in Execution Factory

The Data Analyst toolbox and data understanding toolbox are now built into the Execution Factory. Core tools are ready to use out of the box without additional configuration, shortening the capability enablement cycle for Data Analyst and data understanding scenarios, and lowering the barrier to tool adoption.

### 3. Bug Fixes

- Fixed an issue where users with Agent publishing permissions did not see the "More Scenarios" entry on their first visit to the intelligent data querying page, preventing them from publishing Agents—ensuring users with the relevant permissions can complete Agent publishing normally.
- Fixed an issue where the variable reference selector could not select sub-fields from specific indexed array elements (e.g., Business Knowledge Network ID — `self_config.data_source.knowledge_network[0].knowledge_network_id`) when configuring Agent skill parameters.
- Fixed an issue where the admin account was automatically logged out when accessing approval templates under workflows.

---

## Version Release

For more information about this release, visit our GitHub open source repositories:

- DIP Studio: https://github.com/kweaver-ai/kweaver-dip/tree/main/dip-studio
- Data Semantic Governance: https://github.com/kweaver-ai/kweaver-dip/tree/main/dsg
- Data Analyst: https://github.com/kweaver-ai/kweaver-dip/tree/main/chat-data
