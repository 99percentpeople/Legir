import React from "react";
import { FormField, Annotation } from "@/types";
import { BaseControlProps } from "../types";
import { PropertyPanelProps } from "../properties/types";

/**
 * Configuration interface for a registered control.
 */
export interface ControlConfig<T = FormField | Annotation> {
  /** Unique type identifier for the control (e.g., FieldType value) */
  type: string;
  /** The React component used to render the control on the canvas */
  component: React.ComponentType<BaseControlProps<T>>;
  /** The React component used to render the properties panel for this control */
  propertiesComponent?: React.ComponentType<PropertyPanelProps<T>>;
  /** Display label for the control */
  label: string;
  /** Whether width/height can be edited from the shared geometry panel */
  supportsGeometrySizeEdit?: boolean | ((data: T) => boolean);
  /** Optional custom serializer for control data */
  serialize?: (data: T) => any;
  /** Optional custom deserializer for control data */
  deserialize?: (data: any) => T;
}

/**
 * Singleton registry for managing workspace controls.
 * Handles registration, retrieval, and configuration of form and functional controls.
 */
export class ControlRegistry {
  private static instance: ControlRegistry;
  private controls: Map<string, ControlConfig<any>> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance of the registry.
   */
  public static getInstance(): ControlRegistry {
    if (!ControlRegistry.instance) {
      ControlRegistry.instance = new ControlRegistry();
    }
    return ControlRegistry.instance;
  }

  /**
   * Register a new control configuration.
   * @param config The control configuration to register.
   */
  public register<T>(config: ControlConfig<T>) {
    this.controls.set(config.type, config);
  }

  /**
   * Retrieve a control configuration by type.
   * @param type The unique type identifier of the control.
   */
  public get(type: string): ControlConfig<any> | undefined {
    return this.controls.get(type);
  }

  /**
   * Get all registered control configurations.
   */
  public getAll(): ControlConfig<any>[] {
    return Array.from(this.controls.values());
  }

  /**
   * Serialize control data. Uses custom serializer if registered, otherwise returns identity.
   * Note: Actual JSON stringification happens at the document level. This is for data transformation.
   */
  public serialize(type: string, data: any): any {
    const config = this.get(type);
    if (config && config.serialize) {
      return config.serialize(data);
    }
    return data;
  }

  /**
   * Deserialize control data. Uses custom deserializer if registered, otherwise returns identity.
   */
  public deserialize(type: string, data: any): any {
    const config = this.get(type);
    if (config && config.deserialize) {
      return config.deserialize(data);
    }
    return data;
  }
}

export const registry = ControlRegistry.getInstance();
